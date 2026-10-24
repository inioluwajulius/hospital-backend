const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const sendEmail = require('./email');
const otp = require('./otp');
const { verificationCodeEmail, passwordResetCodeEmail } = require('./emailTemplates');

/**
 * Account management shared by the super admin (any hospital) and hospital admins
 * (their own hospital). Every operation is scoped to `hospitalId`, which callers
 * derive from trusted state: the verified super admin token + URL, or the hospital
 * admin's own token. Passwords are never returned; resets go through emailed codes
 * or a one-time temporary password the user must change at next login.
 */

const STAFF_ROLES = ['doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'radiologist', 'accountant'];
const STATUSES = ['active', 'inactive', 'suspended', 'pending', 'rejected'];
const PUBLIC_FIELDS = 'name email phone role status isEmailVerified emailVerificationRequired department specialization licenseNumber yearsOfExperience hospitalId createdAt lastLoginAt mustChangePassword isSuperAdmin invitedBy';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Roles an actor may assign. Nobody can grant super_admin here. */
const assignableRoles = (actor) => (actor.isSuperAdmin ? [...STAFF_ROLES, 'hospital_admin'] : STAFF_ROLES);

const serialize = (user) => {
    const u = typeof user.toObject === 'function' ? user.toObject() : user;
    return {
        _id: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status,
        isEmailVerified: Boolean(u.isEmailVerified),
        emailVerificationRequired: Boolean(u.emailVerificationRequired),
        department: u.department,
        specialization: u.specialization,
        licenseNumber: u.licenseNumber,
        yearsOfExperience: u.yearsOfExperience,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        mustChangePassword: Boolean(u.mustChangePassword),
        invited: Boolean(u.invitedBy), // joined through a staff invitation
    };
};

/** List a hospital's users with role/status/search filters and pagination */
const listUsers = async (hospitalId, { role, status, search, page = 1, limit = 20, includePatients = false } = {}) => {
    const query = { hospitalId, isSuperAdmin: { $ne: true } };
    if (typeof role === 'string' && role) {
        if (role === 'patient' && !includePatients) throw httpError(403, 'Patient accounts are managed from the Patients page');
        query.role = role === 'staff' ? { $in: STAFF_ROLES } : role;
    } else if (!includePatients) {
        query.role = { $ne: 'patient' };
    }
    if (typeof status === 'string' && STATUSES.includes(status)) query.status = status;
    if (typeof search === 'string' && search.trim()) {
        const re = new RegExp(escapeRegex(search.trim().slice(0, 100)), 'i');
        query.$or = [{ name: re }, { email: re }, { phone: re }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const [users, total] = await Promise.all([
        User.find(query).select(PUBLIC_FIELDS).sort({ createdAt: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize),
        User.countDocuments(query),
    ]);
    return { users: users.map(serialize), pagination: { total, page: pageNum, pages: Math.max(1, Math.ceil(total / pageSize)), limit: pageSize } };
};

/** Counts per role/status for dashboards */
const userCounts = async (hospitalId) => {
    const rows = await User.aggregate([
        { $match: { hospitalId: new mongoose.Types.ObjectId(String(hospitalId)), isSuperAdmin: { $ne: true } } },
        { $group: { _id: { role: '$role', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const counts = { admins: 0, doctors: 0, staff: 0, patients: 0, active: 0, pending: 0, unverified: 0 };
    for (const { _id, n } of rows) {
        if (_id.role === 'hospital_admin') counts.admins += n;
        else if (_id.role === 'doctor') counts.doctors += n;
        else if (_id.role === 'patient') counts.patients += n;
        else counts.staff += n;
        if (_id.role !== 'patient') {
            if (_id.status === 'active') counts.active += n;
            if (_id.status === 'pending') counts.pending += n;
        }
    }
    counts.unverified = await User.countDocuments({ hospitalId, emailVerificationRequired: true, isEmailVerified: { $ne: true } });
    return counts;
};

const findManagedUser = async (hospitalId, userId, { includePatients = false } = {}) => {
    if (!mongoose.isValidObjectId(userId)) throw httpError(404, 'User not found');
    const user = await User.findOne({ _id: userId, hospitalId, isSuperAdmin: { $ne: true } });
    if (!user || (user.role === 'patient' && !includePatients)) throw httpError(404, 'User not found');
    return user;
};

const getUser = async (hospitalId, userId, opts) => serialize(await findManagedUser(hospitalId, userId, opts));

/**
 * Update permitted fields. Guards:
 * - nobody changes their own role or status (no accidental self lock-out),
 * - hospital admins can't change another admin's role or status,
 * - role changes only to roles the actor may assign; never super_admin,
 * - a new email must be unique in the hospital and is re-verified.
 */
const updateUser = async (hospitalId, userId, body = {}, actor) => {
    const user = await findManagedUser(hospitalId, userId, { includePatients: actor.isSuperAdmin });
    const isSelf = String(user._id) === String(actor.userId);
    const changes = {};
    const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

    if (body.name !== undefined) {
        const name = str(body.name, 100);
        if (!name || name.length < 2) throw httpError(400, 'Name must be at least 2 characters');
        changes.name = name;
    }
    if (body.phone !== undefined) {
        const phone = str(body.phone, 30);
        if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) throw httpError(400, 'Enter a valid phone number');
        changes.phone = phone;
    }
    for (const field of ['department', 'specialization', 'licenseNumber']) {
        if (body[field] !== undefined) changes[field] = str(body[field], 100);
    }
    if (body.yearsOfExperience !== undefined && body.yearsOfExperience !== '') {
        const years = Number(body.yearsOfExperience);
        if (!Number.isInteger(years) || years < 0 || years > 70) throw httpError(400, 'Years of experience must be a whole number between 0 and 70');
        changes.yearsOfExperience = years;
    }

    const protectedAdmin = user.role === 'hospital_admin' && !actor.isSuperAdmin;
    if (body.role !== undefined && body.role !== user.role) {
        if (isSelf) throw httpError(400, 'You cannot change your own role');
        if (protectedAdmin) throw httpError(403, 'Only the platform super admin can change a hospital admin\'s role');
        if (user.role === 'patient' || !assignableRoles(actor).includes(body.role)) throw httpError(400, 'That role cannot be assigned');
        changes.role = body.role;
    }
    if (body.status !== undefined && body.status !== user.status) {
        if (isSelf) throw httpError(400, 'You cannot change your own account status');
        if (protectedAdmin) throw httpError(403, 'Only the platform super admin can change a hospital admin\'s status');
        if (!['active', 'inactive', 'suspended'].includes(body.status)) throw httpError(400, 'Status must be active, inactive or suspended');
        changes.status = body.status;
    }

    let emailChanged = false;
    if (body.email !== undefined) {
        const email = normalizeEmail(body.email);
        if (email !== user.email) {
            if (!isValidEmail(email)) throw httpError(400, 'Enter a valid email address');
            const taken = await User.findOne({ email, hospitalId, _id: { $ne: user._id } }).select('_id');
            if (taken) throw httpError(409, 'Another account in this hospital already uses that email');
            changes.email = email;
            changes.isEmailVerified = false;
            changes.emailVerificationRequired = Boolean(sendEmail.isEmailConfigured && sendEmail.isEmailConfigured());
            emailChanged = true;
        }
    }

    if (!Object.keys(changes).length) return { user: serialize(user), emailChanged: false };
    const updated = await User.findOneAndUpdate({ _id: user._id, hospitalId }, { $set: changes }, { new: true, runValidators: true }).select(PUBLIC_FIELDS);
    if (emailChanged) await sendVerification(updated).catch((err) => console.error('Verification email failed:', err.message));
    return { user: serialize(updated), emailChanged };
};

const sendVerification = async (user) => {
    const result = await otp.issueCode(user.email, 'email_verification');
    if (!result.issued) return { sent: false, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds };
    const mail = verificationCodeEmail({ name: user.name, code: result.code, expiresInMinutes: result.expiresInMinutes });
    const delivery = await sendEmail({ email: user.email, subject: mail.subject, message: mail.text, html: mail.html });
    return { sent: delivery?.sent !== false };
};

/** Resend email verification for an unverified account */
const resendVerification = async (hospitalId, userId, actor) => {
    const user = await findManagedUser(hospitalId, userId, { includePatients: actor.isSuperAdmin });
    if (user.isEmailVerified) throw httpError(400, 'This email address is already verified');
    if (!(sendEmail.isEmailConfigured && sendEmail.isEmailConfigured())) throw httpError(503, 'Email delivery is not configured on the server');
    const result = await sendVerification(user);
    if (!result.sent) throw httpError(429, result.reason === 'cooldown' ? `A code was sent recently. Try again in ${result.retryAfterSeconds}s.` : 'Too many codes sent recently. Try again later.');
    return { message: `Verification code sent to ${user.email}` };
};

/** Email the user a password reset code (they finish on the Forgot password page) */
const emailPasswordReset = async (hospitalId, userId, actor) => {
    const user = await findManagedUser(hospitalId, userId, { includePatients: actor.isSuperAdmin });
    if (!(sendEmail.isEmailConfigured && sendEmail.isEmailConfigured())) {
        throw httpError(503, 'Email delivery is not configured on the server. Use a temporary password instead.');
    }
    const result = await otp.issueCode(user.email, 'password_reset');
    if (!result.issued) throw httpError(429, result.reason === 'cooldown' ? `A reset code was sent recently. Try again in ${result.retryAfterSeconds}s.` : 'Too many reset codes sent recently. Try again later.');
    const mail = passwordResetCodeEmail({ name: user.name, code: result.code, expiresInMinutes: result.expiresInMinutes, initiatedByAdmin: true });
    await sendEmail({ email: user.email, subject: mail.subject, message: mail.text, html: mail.html });
    return { message: `A password reset code was emailed to ${user.email}. It expires in ${result.expiresInMinutes} minutes.` };
};

/** 12+ character temporary password with every character class */
const generateTemporaryPassword = () => {
    const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
    const all = sets.join('');
    const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
    while (chars.length < 14) chars.push(all[crypto.randomInt(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
};

/**
 * Set a one-time temporary password. Returned once to the admin (never stored in plain
 * text or logged); the user must change it at next login.
 */
const setTemporaryPassword = async (hospitalId, userId, actor) => {
    const user = await findManagedUser(hospitalId, userId, { includePatients: actor.isSuperAdmin });
    if (String(user._id) === String(actor.userId)) throw httpError(400, 'Use Settings to change your own password');
    const temporaryPassword = generateTemporaryPassword();
    await User.updateOne(
        { _id: user._id, hospitalId },
        { $set: { password: await bcrypt.hash(temporaryPassword, 10), mustChangePassword: true }, $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } }
    );
    await otp.clearCodes(user.email, ['password_reset', 'password_reset_grant']);
    return { temporaryPassword, message: 'Temporary password set. Share it securely; the user must choose a new password when they log in.' };
};

module.exports = {
    STAFF_ROLES,
    assignableRoles,
    serialize,
    listUsers,
    userCounts,
    getUser,
    updateUser,
    resendVerification,
    emailPasswordReset,
    setTemporaryPassword,
    generateTemporaryPassword,
};
