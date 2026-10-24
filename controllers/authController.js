const User = require("../models/User");
const Patient = require("../models/Patient");
const Hospital = require("../models/Hospital");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const socketService = require("../socket");
const crypto = require("crypto");
const sendEmail = require("../utils/email");
const otp = require("../utils/otp");
const { verificationCodeEmail, passwordResetCodeEmail, passwordChangedEmail } = require("../utils/emailTemplates");

const PASSWORD_REQUIREMENTS_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';

const normalizeEmail = (email) => {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

// Compare phone numbers by digits only so "0803 123 4567" matches "08031234567"
const samePhone = (a, b) => {
    const digits = (v) => String(v || '').replace(/\D/g, '');
    return digits(a).length > 0 && digits(a) === digits(b);
};

// Roles that may self-register as staff. Both require hospital admin approval.
// Other staff roles are created through hospital admin invitations.
const SELF_REGISTER_STAFF_ROLES = ['DOCTOR', 'NURSE'];

const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidEmailDomain = (email, userType) => {
    const lowerEmail = email.toLowerCase();
    
    if (userType === 'staff') {
        // Staff must use hospital domains
        const staffDomains = ['@hospital.com', '@healthcare.com', '@medical.com'];
        return staffDomains.some(domain => lowerEmail.endsWith(domain));
    } else if (userType === 'patient') {
        // Patients must use personal email domains
        const personalDomains = ['@gmail.com', '@yahoo.com', '@outlook.com', '@hotmail.com', '@aol.com', '@mail.com'];
        return personalDomains.some(domain => lowerEmail.endsWith(domain));
    }
    
    return true;
};

const isStrongPassword = (password) => {
    if (typeof password !== 'string') {
        return false;
    }

    const hasMinLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialCharacter = /[^A-Za-z0-9]/.test(password);

    return hasMinLength && hasUppercase && hasLowercase && hasNumber && hasSpecialCharacter;
};

const buildSafeUser = (user) => {
    if (!user) {
        return null;
    }

    const userObject = typeof user.toObject === 'function' ? user.toObject() : user;

    return {
        id: userObject._id,
        name: userObject.name,
        email: userObject.email,
        role: userObject.role
    };
};

// Generate patient card
const generatePatientCard = () => {
    return 'PAT-' + Math.floor(100000 + Math.random() * 900000);
};


// New accounts must verify their email only when email delivery is configured,
// so development setups without SMTP (and all pre-existing accounts) aren't locked out.
const isVerificationRequired = () => Boolean(sendEmail.isEmailConfigured && sendEmail.isEmailConfigured());

const sendVerificationCode = async (user) => {
    const result = await otp.issueCode(user.email, 'email_verification');
    if (!result.issued) return false;
    const mail = verificationCodeEmail({ name: user.name, code: result.code, expiresInMinutes: result.expiresInMinutes });
    await sendEmail({ email: user.email, subject: mail.subject, message: mail.text, html: mail.html });
    return true;
};

/** Start email verification for a newly registered user; returns fields for the API response. */
const startEmailVerification = async (user) => {
    if (!user.emailVerificationRequired) {
        return { requiresEmailVerification: false };
    }
    try {
        await sendVerificationCode(user);
    } catch (error) {
        // The account exists; the user can request a new code from the verification page
        console.error('Could not send verification code:', error.message);
    }
    return { requiresEmailVerification: true, email: user.email };
};

const CODE_ERROR_MESSAGES = {
    invalid: "That code is incorrect. Use the code from the most recent email (a new code replaces older ones), or request a new one.",
    expired: 'This code has expired. Please request a new one.',
    too_many_attempts: 'Too many incorrect attempts. Please request a new code.',
};
// Password reset uses one message for every failure so it doesn't reveal whether an account exists
const RESET_CODE_ERROR = 'The code is incorrect or has expired. Use the code from the most recent email, or request a new one.';
const GENERIC_RESEND_MESSAGE = 'If this email needs verification, a new code has been sent.';
const GENERIC_RESET_REQUEST_MESSAGE = "If an account exists with this email, we've sent a 6-digit password reset code.";

const handleStaffRegistration = async (req, res, { name, normalizedEmail, hashedPassword, verificationToken, emailVerificationToken, emailVerificationExpires, role, effectiveHospitalId, specialization, licenseNumber, yearsOfExperience }) => {
    if (!role || !SELF_REGISTER_STAFF_ROLES.includes(String(role).toUpperCase())) {
        return res.status(400).json({ message: 'Valid role required for staff (Doctor or Nurse)' });
    }

    const parsedYearsOfExperience =
        yearsOfExperience === undefined || yearsOfExperience === null || yearsOfExperience === ''
            ? undefined
            : Number.parseInt(yearsOfExperience, 10);

    if (role.toLowerCase() === 'doctor' && parsedYearsOfExperience !== undefined && Number.isNaN(parsedYearsOfExperience)) {
        return res.status(400).json({ message: 'Years of experience must be a valid number' });
    }

    // Self-registered staff require hospital admin approval before they can log in
    const Status = 'pending';

    const newUser = new User({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        emailVerificationToken,
        emailVerificationExpires,
        emailVerificationRequired: isVerificationRequired(),
        role: role.toLowerCase(),
        status: Status,
        hospitalId: effectiveHospitalId ? new mongoose.Types.ObjectId(effectiveHospitalId) : undefined,
        // Doctor-specific fields
        specialization: role.toLowerCase() === 'doctor' ? specialization : undefined,
        licenseNumber: role.toLowerCase() === 'doctor' ? licenseNumber : undefined,
        yearsOfExperience: role.toLowerCase() === 'doctor' ? parsedYearsOfExperience : undefined,
    });
    await newUser.save();

    // Notify hospital admins
    if (effectiveHospitalId) {
        try {
            const admins = await User.find({ role: 'hospital_admin', hospitalId: effectiveHospitalId });
            if (admins.length > 0) {
                const notifications = admins.map(admin => ({
                    recipient: admin._id,
                    hospitalId: effectiveHospitalId,
                    type: 'REGISTRATION',
                    message: `New staff member registered: ${name} (${role.toUpperCase()})`,
                    link: '/admin/pending-approvals'
                }));
                const savedNotifications = await Notification.insertMany(notifications);
                
                const io = socketService.getIO();
                if (io) {
                    savedNotifications.forEach(notif => {
                        io.to(notif.recipient.toString()).emit('new_notification', notif);
                    });
                }
            }
        } catch (err) {
            console.error('Notification error:', err);
        }
    }

    // Tests expect a generic staff registration success message
    const verification = await startEmailVerification(newUser);
    return res.status(201).json({
        message: 'Staff registration successful. Your account will be active once a hospital administrator approves it.',
        userId: newUser._id,
        ...verification
    });
};

const handlePatientRegistration = async (req, res, { name, normalizedEmail, hashedPassword, verificationToken, emailVerificationToken, emailVerificationExpires, effectiveHospitalId, existingPatientId, phone, gender, age, bloodGroup }) => {
    let patientRecord;
    const patientCard = generatePatientCard();

    // Case 1: Link to existing patient record
    if (existingPatientId) {
        if (!mongoose.isValidObjectId(existingPatientId)) {
            return res.status(404).json({ message: 'Patient record not found' });
        }
        const existing = await Patient.findOne({ _id: existingPatientId, hospitalId: effectiveHospitalId });
        // The caller must prove they own the record by supplying its phone number
        if (!existing || !samePhone(phone, existing.phone)) {
            return res.status(404).json({ message: 'Patient record not found' });
        }
        if (existing.userId) {
            return res.status(400).json({ message: 'This patient record is already linked to an account. Please log in instead.' });
        }

        // Create user linked to existing patient
        const newUser = new User({
            name,
            email: normalizedEmail,
            password: hashedPassword,
            emailVerificationToken,
            emailVerificationExpires,
            emailVerificationRequired: isVerificationRequired(),
            role: 'patient',
            status: 'active', // Patients active immediately
            hospitalId: effectiveHospitalId ? new mongoose.Types.ObjectId(effectiveHospitalId) : undefined,
            patientCardNumber: existing.patientCardNumber
        });
        await newUser.save();

        // Link the patient record to the new account
        existing.userId = newUser._id;
        existing.status = 'active';
        existing.registrationStatus = 'existing_linked';
        existing.gender = existing.gender || gender;
        existing.bloodGroup = existing.bloodGroup || bloodGroup;
        await existing.save();

        const verification = await startEmailVerification(newUser);
        return res.status(201).json({
            message: 'Registration successful! You can now access your medical records.',
            userId: newUser._id,
            patientCardNumber: existing.patientCardNumber,
            status: 'active',
            ...verification
        });
    }

    // Case 2: Create new patient record
    if (!effectiveHospitalId) {
        return res.status(400).json({ message: 'System error: No hospital configured in the system. Please contact administration.' });
    }

    const newUser = new User({
        name,
        email: normalizedEmail,
        password: hashedPassword,
        emailVerificationToken,
        emailVerificationExpires,
        emailVerificationRequired: isVerificationRequired(),
        role: 'patient',
        status: 'active', // Patients active immediately
        hospitalId: new mongoose.Types.ObjectId(effectiveHospitalId),
        patientCardNumber: patientCard
    });
    await newUser.save();

    // Create corresponding patient record
    patientRecord = new Patient({
        userId: newUser._id,
        hospitalId: new mongoose.Types.ObjectId(effectiveHospitalId), // FIX: Missing hospitalId
        patientCardNumber: patientCard,
        status: 'active',
        registrationStatus: 'self_registered',
        phone: phone || '',
        gender: gender || '',
        age: age || null,
        bloodGroup: bloodGroup || ''
    });
    await patientRecord.save();

    // Notify hospital admins
    try {
        const admins = await User.find({ role: 'hospital_admin', hospitalId: effectiveHospitalId });
        if (admins.length > 0) {
            const notifications = admins.map(admin => ({
                recipient: admin._id,
                hospitalId: effectiveHospitalId,
                type: 'REGISTRATION',
                message: `New patient registered: ${name}`,
                link: '/admin/patients'
            }));
            const savedNotifications = await Notification.insertMany(notifications);
            
            const io = socketService.getIO();
            if (io) {
                savedNotifications.forEach(notif => {
                    io.to(notif.recipient.toString()).emit('new_notification', notif);
                });
            }
        }
    } catch (err) {
        console.error('Notification error:', err);
    }

    const verification = await startEmailVerification(newUser);
    return res.status(201).json({
        message: 'Registration successful! You can now access your account.',
        userId: newUser._id,
        patientCardNumber: patientCard,
        status: 'active',
        ...verification
    });
};

exports.register = async (req, res) => {
    try {
        const { name, email, password, userType, role, phone, age, gender, bloodGroup, existingPatientId, specialization, licenseNumber, yearsOfExperience, hospitalId } = req.body || {};
        const normalizedEmail = normalizeEmail(email);

        // Validate basic fields
        if (!name || !normalizedEmail || !password || !userType) {
            return res.status(400).json({ message: 'Name, email, password, and user type are required' });
        }

        let effectiveHospitalId = hospitalId || req.tenant?.id || req.tenant?.hospital?._id;
        if (!effectiveHospitalId) {
            return res.status(400).json({ message: 'Hospital ID is required for registration' });
        }
        if (!mongoose.isValidObjectId(effectiveHospitalId)) {
            return res.status(400).json({ message: 'Invalid hospital' });
        }
        const hospital = await Hospital.findById(effectiveHospitalId).select('status');
        if (!hospital || hospital.status !== 'active') {
            return res.status(400).json({ message: 'Invalid hospital' });
        }

        // Email domain restriction removed to allow any valid email address for both staff and patients
        // so you don't have to create fake hospital emails.

        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        }

        const query = { email: normalizedEmail };
        if (effectiveHospitalId) {
            query.hospitalId = effectiveHospitalId;
        }

        const existingUser = await User.findOne(query);
        if (existingUser) {
            return res.status(400).json({ message: 'Email already exists in this hospital' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
        const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;

        const commonArgs = {
            name, normalizedEmail, hashedPassword, verificationToken, emailVerificationToken, emailVerificationExpires, effectiveHospitalId
        };

        if (userType === 'staff') {
            return await handleStaffRegistration(req, res, {
                ...commonArgs,
                role, specialization, licenseNumber, yearsOfExperience
            });
        }

        if (userType === 'patient') {
            return await handlePatientRegistration(req, res, {
                ...commonArgs,
                existingPatientId, phone, gender, age, bloodGroup
            });
        }

        return res.status(400).json({ message: 'Invalid user type. Must be "staff" or "patient"' });

    } catch (error) {
        console.error('Registration Error:', error);
        return res.status(500).json({
            message: 'Server error: ' + error.message,
            error: error.message
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password, hospitalId } = req.body || {};
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || typeof password !== 'string' || password.length === 0) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // Multi-tenant user lookup: find user by email and hospital (if provided by body or subdomain)
        let effectiveHospitalId = hospitalId || req.tenant?.id || req.tenant?.hospital?._id;

        const query = { email: normalizedEmail };
        if (effectiveHospitalId) {
            query.hospitalId = new mongoose.Types.ObjectId(effectiveHospitalId);
        }

        const existingUsers = await User.find(query).populate('hospitalId', 'name').select('+password');

        if (existingUsers.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // Find all matching users by password
        const matchingUsers = [];
        for (let user of existingUsers) {
            if (typeof user.password === 'string' && user.password.length > 0) {
                const isMatch = await bcrypt.compare(password, user.password);
                if (isMatch) {
                    matchingUsers.push(user);
                }
            }
        }

        if (matchingUsers.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        let existingUser;
        if (matchingUsers.length === 1) {
            existingUser = matchingUsers[0];
        } else {
            // Multiple users found with the same email and valid password.
            if (!effectiveHospitalId) {
                // Workspace Selection UX
                const workspaces = matchingUsers.map(u => ({
                    id: u.hospitalId?._id || 'default',
                    name: u.hospitalId?.name || 'Default Hospital',
                    role: u.role
                }));
                return res.status(300).json({
                    message: 'Multiple workspaces found. Please select a hospital.',
                    workspaces
                });
            } else {
                existingUser = matchingUsers[0];
            }
        }

        if (existingUser.emailVerificationRequired && !existingUser.isEmailVerified) {
            return res.status(403).json({
                message: 'Please verify your email address before logging in.',
                code: 'EMAIL_NOT_VERIFIED',
                email: existingUser.email,
            });
        }

        if (existingUser.status === 'pending') {
            return res.status(403).json({ message: 'Your account is awaiting approval by hospital administration.' });
        }

        if (existingUser.status === 'rejected') {
            return res.status(403).json({ message: 'Your registration has been rejected. Please contact hospital administration.' });
        }

        if (existingUser.status === 'inactive' || existingUser.status === 'suspended') {
            return res.status(403).json({ message: 'Your account has been deactivated. Please contact hospital administration.' });
        }

        // Create JWT with multi-tenant context
        const token = jwt.sign({
            userId: existingUser._id,
            email: existingUser.email,
            role: existingUser.role,
            hospitalId: existingUser.hospitalId?._id || existingUser.hospitalId || null,
            isSuperAdmin: existingUser.isSuperAdmin || false,
        }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: buildSafeUser(existingUser) });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.buildSafeUser = buildSafeUser;
exports.PASSWORD_REQUIREMENTS_MESSAGE = PASSWORD_REQUIREMENTS_MESSAGE;
exports.verifyEmail = async (req, res) => {
    try {
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
        const user = await User.findOne({
            emailVerificationToken: hashedToken,
            emailVerificationExpires: { $gt: Date.now() }
        });
        if (!user) { return res.status(400).json({ message: 'Token is invalid or has expired' }); }
        user.isEmailVerified = true; user.emailVerificationToken = undefined; user.emailVerificationExpires = undefined;
        await user.save();
        res.status(200).json({ message: 'Email successfully verified' });
    } catch (error) { res.status(500).json({ message: 'Server error', error: error.message }); }
};

exports.forgotPassword = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Please enter a valid email address' });
        }

        // Same response whether or not the account exists, so emails can't be enumerated.
        // Delivery problems are logged, not reported, for the same reason.
        const user = await User.findOne({ email }).select('name email');
        if (user) {
            try {
                const result = await otp.issueCode(email, 'password_reset');
                if (result.issued) {
                    const mail = passwordResetCodeEmail({ name: user.name, code: result.code, expiresInMinutes: result.expiresInMinutes });
                    await sendEmail({ email, subject: mail.subject, message: mail.text, html: mail.html });
                }
            } catch (error) {
                console.error('Could not send password reset code:', error.message);
            }
        }

        res.status(200).json({ message: GENERIC_RESET_REQUEST_MESSAGE, retryAfterSeconds: otp.RESEND_COOLDOWN_SECONDS });
    } catch (error) {
        console.error('Forgot password error:', error.message);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

/** POST /auth/verify-reset-code  { email, code } -> { resetToken } (single use, short-lived) */
exports.verifyResetCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const result = await otp.verifyCode(email, 'password_reset', req.body?.code);
        if (!result.valid) {
            return res.status(400).json({ message: RESET_CODE_ERROR, code: 'INVALID_CODE' });
        }

        const grant = await otp.createResetGrant(email);
        res.status(200).json({
            message: 'Code verified. You can now choose a new password.',
            resetToken: grant.token,
            expiresInMinutes: grant.expiresInMinutes,
        });
    } catch (error) {
        console.error('Verify reset code error:', error.message);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

/** POST /auth/reset-password  { resetToken, password, confirmPassword } */
exports.resetPasswordWithCode = async (req, res) => {
    try {
        const { resetToken, password, confirmPassword } = req.body || {};
        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        }
        if (confirmPassword !== undefined && confirmPassword !== password) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        // Atomically consume the grant: it can authorise exactly one password change
        const email = await otp.consumeResetGrant(resetToken);
        if (!email) {
            return res.status(400).json({ message: 'Your reset session is invalid or has expired. Please request a new code.', code: 'INVALID_RESET_SESSION' });
        }

        // The grant proves ownership of the email, so every account on it gets the new password
        const hashedPassword = await bcrypt.hash(password, 10);
        const users = await User.find({ email }).select('name');
        await User.updateMany(
            { email },
            { $set: { password: hashedPassword, isEmailVerified: true }, $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } }
        );
        await otp.clearCodes(email, ['password_reset', 'password_reset_grant']);

        try {
            const mail = passwordChangedEmail({ name: users[0]?.name });
            await sendEmail({ email, subject: mail.subject, message: mail.text, html: mail.html });
        } catch (error) {
            console.error('Could not send password changed notification:', error.message);
        }

        res.status(200).json({ message: 'Your password has been reset. You can now log in with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error.message);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

/** POST /auth/resend-verification-code  { email } (generic response) */
exports.resendVerificationCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        if (!isValidEmail(email)) {
            return res.status(400).json({ message: 'Please enter a valid email address' });
        }

        const user = await User.findOne({ email, emailVerificationRequired: true, isEmailVerified: { $ne: true } }).select('name email');
        if (user) {
            try {
                await sendVerificationCode(user);
            } catch (error) {
                console.error('Could not resend verification code:', error.message);
            }
        }

        res.status(200).json({ message: GENERIC_RESEND_MESSAGE, retryAfterSeconds: otp.RESEND_COOLDOWN_SECONDS });
    } catch (error) {
        console.error('Resend verification error:', error.message);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

/** POST /auth/verify-email  { email, code } */
exports.verifyEmailCode = async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const result = await otp.verifyCode(email, 'email_verification', req.body?.code);
        if (!result.valid) {
            return res.status(400).json({ message: CODE_ERROR_MESSAGES[result.reason] || CODE_ERROR_MESSAGES.invalid, code: result.reason.toUpperCase() });
        }

        // The code proves ownership of the email address, which covers every account on it
        await User.updateMany(
            { email },
            { $set: { isEmailVerified: true }, $unset: { emailVerificationToken: 1, emailVerificationExpires: 1 } }
        );
        res.status(200).json({ message: 'Your email has been verified. You can now log in.' });
    } catch (error) {
        console.error('Verify email error:', error.message);
        res.status(500).json({ message: 'Something went wrong. Please try again.' });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
        const user = await User.findOne({ resetPasswordToken: hashedToken, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) { return res.status(400).json({ message: 'Token is invalid or has expired' }); }
        if (!isStrongPassword(req.body.password)) { return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE }); }
        user.password = await bcrypt.hash(req.body.password, 10);
        user.resetPasswordToken = undefined; user.resetPasswordExpires = undefined;
        await user.save();
        res.status(200).json({ message: 'Password successfully updated' });
    } catch (error) { res.status(500).json({ message: 'Server error', error: error.message }); }
};
