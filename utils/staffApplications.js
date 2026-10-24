const mongoose = require('mongoose');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const sendEmail = require('./email');
const { applicationDecisionEmail } = require('./emailTemplates');
const { recordAudit } = require('./audit');

/**
 * Self-registered staff applications (doctors and nurses who signed up and chose
 * a hospital). The account itself is the application: it stays status 'pending'
 * until an admin of that hospital approves ('active') or rejects ('rejected') it.
 * Invited staff are excluded: they activate by accepting their invitation.
 *
 * Every call takes `hospitalId`, which callers derive from trusted state (the
 * hospital admin's signed token, or a hospital the super admin selected).
 * `hospitalId === null` is only passed for super admins viewing all hospitals.
 */

const APPLICANT_ROLES = ['doctor', 'nurse'];
const FIELDS = 'name email phone role status specialization licenseNumber yearsOfExperience department hospitalId createdAt isEmailVerified emailVerificationRequired approvedAt rejectedAt rejectionReason';

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// invitedBy: null matches documents where the field is missing or null
const baseQuery = (hospitalId) => ({
    role: { $in: APPLICANT_ROLES },
    invitedBy: null,
    hospitalId: hospitalId ? new mongoose.Types.ObjectId(String(hospitalId)) : { $ne: null },
});

const serialize = (u) => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    specialization: u.specialization,
    licenseNumber: u.licenseNumber,
    yearsOfExperience: u.yearsOfExperience,
    department: u.department,
    hospital: u.hospitalId && typeof u.hospitalId === 'object' && u.hospitalId.name
        ? { _id: u.hospitalId._id, name: u.hospitalId.name }
        : { _id: u.hospitalId },
    appliedAt: u.createdAt,
    emailVerified: !u.emailVerificationRequired || Boolean(u.isEmailVerified),
    approvedAt: u.approvedAt,
    rejectedAt: u.rejectedAt,
    rejectionReason: u.rejectionReason,
});

/** Applications in a hospital (or all hospitals for the super admin), newest first */
const listApplications = async (hospitalId, { status = 'pending', role, search } = {}) => {
    const query = baseQuery(hospitalId);
    query.status = ['pending', 'rejected'].includes(status) ? status : 'pending';
    if (APPLICANT_ROLES.includes(role)) query.role = role;
    if (typeof search === 'string' && search.trim()) {
        const re = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
        query.$or = [{ name: re }, { email: re }, { specialization: re }, { licenseNumber: re }];
    }
    const users = await User.find(query).select(FIELDS).populate('hospitalId', 'name').sort({ createdAt: -1 }).limit(200);
    return users.map(serialize);
};

const getApplication = async (hospitalId, userId) => {
    if (!mongoose.isValidObjectId(userId)) throw httpError(404, 'Application not found');
    const user = await User.findOne({ _id: userId, ...baseQuery(hospitalId) }).select(FIELDS).populate('hospitalId', 'name');
    if (!user) throw httpError(404, 'Application not found in this hospital');
    return serialize(user);
};

const notifyApplicant = async (user, approved, reason) => {
    const hospital = await Hospital.findById(user.hospitalId).select('name');
    try {
        await Notification.create({
            recipient: user._id,
            hospitalId: user.hospitalId,
            type: 'REGISTRATION',
            message: approved
                ? `Your account at ${hospital?.name || 'the hospital'} has been approved.`
                : `Your application to ${hospital?.name || 'the hospital'} was not approved.${reason ? ` Reason: ${reason}` : ''}`,
        });
    } catch (error) {
        console.error('Applicant notification failed:', error.message);
    }
    try {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const mail = applicationDecisionEmail({ name: user.name, hospitalName: hospital?.name, approved, reason, loginUrl: `${frontendUrl}/auth/login/doctor` });
        await sendEmail({ email: user.email, subject: mail.subject, message: mail.text, html: mail.html });
    } catch (error) {
        // The decision stands even if the email can't be delivered
        console.error('Application decision email failed:', error.message);
    }
};

// Let every admin of the hospital refresh their approvals list
const broadcastChange = async (hospitalId, applicationId, status) => {
    const io = socketService.getIO();
    if (!io) return;
    const admins = await User.find({ hospitalId, role: 'hospital_admin' }).select('_id');
    admins.forEach((a) => io.to(String(a._id)).emit('applications:changed', { applicationId: String(applicationId), status }));
};

/**
 * Approve or reject a pending application. The status change is a single atomic
 * update conditioned on status 'pending', so repeated or concurrent decisions
 * cannot both succeed.
 */
const decideApplication = async (hospitalId, userId, decision, actor, { reason } = {}) => {
    if (!mongoose.isValidObjectId(userId)) throw httpError(404, 'Application not found');
    const actorId = String(actor?.userId || actor?._id || '');
    if (actorId && actorId === String(userId)) throw httpError(403, 'You cannot decide on your own application');

    const approve = decision === 'approve';
    const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    const now = new Date();
    const changes = approve
        ? { $set: { status: 'active', approvedBy: actorId, approvedAt: now }, $unset: { rejectedBy: 1, rejectedAt: 1, rejectionReason: 1 } }
        : { $set: { status: 'rejected', rejectedBy: actorId, rejectedAt: now, ...(cleanReason ? { rejectionReason: cleanReason } : {}) } };

    const scope = { _id: userId, ...baseQuery(hospitalId) };
    const user = await User.findOneAndUpdate({ ...scope, status: 'pending' }, changes, { new: true }).select(FIELDS);
    if (!user) {
        const existing = await User.findOne(scope).select('status');
        if (!existing) throw httpError(404, 'Application not found in this hospital');
        const label = existing.status === 'active' ? 'approved' : existing.status;
        throw httpError(409, `This application has already been ${label}.`, { currentStatus: existing.status });
    }

    await Promise.all([
        notifyApplicant(user, approve, cleanReason),
        recordAudit({
            actor,
            hospitalId: user.hospitalId,
            action: approve ? `Approved ${user.role} application` : `Rejected ${user.role} application`,
            details: `${user.name} (${user.email})${!approve && cleanReason ? `. Reason: ${cleanReason}` : ''}`,
            resourceType: 'User',
            resourceId: user._id,
            severity: approve ? 'Info' : 'Warning',
        }),
        broadcastChange(user.hospitalId, user._id, user.status).catch(() => {}),
    ]);

    await user.populate('hospitalId', 'name');
    return serialize(user);
};

module.exports = { APPLICANT_ROLES, listApplications, getApplication, decideApplication };
