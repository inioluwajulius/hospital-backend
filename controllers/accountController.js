const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Appointment = require('../models/Appointment');
const sendEmail = require('../utils/email');
const otp = require('../utils/otp');
const accounts = require('../utils/accountAdmin');
const { passwordChangedEmail, verificationCodeEmail } = require('../utils/emailTemplates');

/**
 * User account management:
 * - super admin: any hospital's users (hospital taken from the URL, verified to exist)
 * - hospital admin: their own hospital only (hospital taken from their signed token)
 * - every user: their own profile, password and email
 */

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const PASSWORD_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';

const actorOf = (req) => ({ userId: req.user.userId, role: req.user.role, isSuperAdmin: Boolean(req.user.isSuperAdmin) });

const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        console.error('Account management error:', error.message);
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
};

/** Super admin routes: resolve and verify the hospital in the URL */
const superAdminHospital = async (req) => {
    const { hospitalId } = req.params;
    if (!mongoose.isValidObjectId(hospitalId)) throw Object.assign(new Error('Hospital not found'), { status: 404 });
    const hospital = await Hospital.findById(hospitalId).select('_id');
    if (!hospital) throw Object.assign(new Error('Hospital not found'), { status: 404 });
    return hospital._id;
};

/** Hospital admin routes: the hospital always comes from the signed token */
const ownHospital = (req) => {
    if (!req.user.hospitalId) throw Object.assign(new Error('No hospital is linked to your account'), { status: 403 });
    return req.user.hospitalId;
};

const resetPassword = async (hospitalId, req, res) => {
    const method = req.body?.method === 'temporary' ? 'temporary' : 'email';
    const result = method === 'temporary'
        ? await accounts.setTemporaryPassword(hospitalId, req.params.userId, actorOf(req))
        : await accounts.emailPasswordReset(hospitalId, req.params.userId, actorOf(req));
    // Never cache a response that may carry a temporary password
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: result });
};

const scoped = (resolveHospital, { includePatients }) => ({
    list: handle(async (req, res) => {
        const hospitalId = await resolveHospital(req);
        const { users, pagination } = await accounts.listUsers(hospitalId, { ...req.query, includePatients });
        // 'data' matches the original /hospital-admin/staff response shape
        res.json({ success: true, data: users, pagination });
    }),
    get: handle(async (req, res) => {
        const hospitalId = await resolveHospital(req);
        res.json({ success: true, data: await accounts.getUser(hospitalId, req.params.userId, { includePatients }) });
    }),
    update: handle(async (req, res) => {
        const hospitalId = await resolveHospital(req);
        const { user, emailChanged } = await accounts.updateUser(hospitalId, req.params.userId, req.body, actorOf(req));
        res.json({ success: true, data: user, message: emailChanged ? 'Saved. A verification code was sent to the new email address.' : 'Saved.' });
    }),
    resetPassword: handle(async (req, res) => resetPassword(await resolveHospital(req), req, res)),
    resendVerification: handle(async (req, res) => {
        const hospitalId = await resolveHospital(req);
        res.json({ success: true, data: await accounts.resendVerification(hospitalId, req.params.userId, actorOf(req)) });
    }),
    stats: handle(async (req, res) => {
        const hospitalId = await resolveHospital(req);
        const [counts, upcomingAppointments] = await Promise.all([
            accounts.userCounts(hospitalId),
            Appointment.countDocuments({ hospitalId, status: { $in: ['scheduled', 'in-progress'] }, appointmentDate: { $gte: new Date(Date.now() - 12 * 3600 * 1000) } }),
        ]);
        res.json({ success: true, data: { ...counts, upcomingAppointments } });
    }),
});

exports.superAdmin = scoped(superAdminHospital, { includePatients: true });
exports.hospitalAdmin = scoped(async (req) => ownHospital(req), { includePatients: false });

// ---------------- Self-service ----------------

const signToken = (user) => jwt.sign({
    userId: user._id,
    email: user.email,
    role: user.role,
    hospitalId: user.hospitalId?._id || user.hospitalId || null,
    isSuperAdmin: user.isSuperAdmin || false,
    ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
}, process.env.JWT_SECRET, { expiresIn: '1d' });

/** PUT /auth/me  { name, phone } */
exports.updateMe = handle(async (req, res) => {
    const changes = {};
    if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim().slice(0, 100);
        if (name.length < 2) return res.status(400).json({ success: false, message: 'Name must be at least 2 characters' });
        changes.name = name;
    }
    if (req.body?.phone !== undefined) {
        const phone = String(req.body.phone).trim().slice(0, 30);
        if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) return res.status(400).json({ success: false, message: 'Enter a valid phone number' });
        changes.phone = phone;
    }
    const user = await User.findByIdAndUpdate(req.user.userId, { $set: changes }, { new: true, runValidators: true }).select('name email phone role status isEmailVerified hospitalId');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, isEmailVerified: user.isEmailVerified } });
});

/** POST /auth/change-password  { currentPassword, newPassword } */
exports.changePassword = handle(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ success: false, message: 'Enter your current password' });
    if (!STRONG_PASSWORD.test(newPassword || '')) return res.status(400).json({ success: false, message: PASSWORD_MESSAGE });
    if (newPassword === currentPassword) return res.status(400).json({ success: false, message: 'Choose a password different from your current one' });

    const user = await User.findById(req.user.userId).select('+password name email role hospitalId isSuperAdmin');
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({ success: false, message: 'Your current password is incorrect' });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();

    try {
        const mail = passwordChangedEmail({ name: user.name });
        await sendEmail({ email: user.email, subject: mail.subject, message: mail.text, html: mail.html });
    } catch (err) {
        console.error('Password changed notification failed:', err.message);
    }
    // Fresh token without the "must change password" restriction
    res.json({ success: true, message: 'Password changed.', token: signToken(user) });
});

/** POST /auth/change-email  { newEmail, password }  new address must be verified with a code */
exports.changeEmail = handle(async (req, res) => {
    const newEmail = typeof req.body?.newEmail === 'string' ? req.body.newEmail.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    if (!(sendEmail.isEmailConfigured && sendEmail.isEmailConfigured())) {
        return res.status(503).json({ success: false, message: 'Email delivery is not configured, so email changes cannot be verified yet' });
    }

    const user = await User.findById(req.user.userId).select('+password name email hospitalId');
    if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.password))) {
        return res.status(400).json({ success: false, message: 'Your password is incorrect' });
    }
    if (newEmail === user.email) return res.status(400).json({ success: false, message: 'That is already your email address' });
    const taken = await User.findOne({ email: newEmail, hospitalId: user.hospitalId, _id: { $ne: user._id } }).select('_id');
    if (taken) return res.status(409).json({ success: false, message: 'Another account in your hospital already uses that email' });

    user.email = newEmail;
    user.isEmailVerified = false;
    user.emailVerificationRequired = true;
    await user.save();

    const code = await otp.issueCode(newEmail, 'email_verification');
    if (code.issued) {
        const mail = verificationCodeEmail({ name: user.name, code: code.code, expiresInMinutes: code.expiresInMinutes });
        await sendEmail({ email: newEmail, subject: mail.subject, message: mail.text, html: mail.html }).catch((err) => console.error('Verification email failed:', err.message));
    }
    res.json({ success: true, message: `Email updated. Enter the code sent to ${newEmail} to verify it.`, email: newEmail });
});

exports._signToken = signToken;
