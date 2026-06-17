const User = require("../models/User");
const Patient = require("../models/Patient");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const socketService = require("../socket");
const crypto = require("crypto");
const sendEmail = require("../utils/email");

const PASSWORD_REQUIREMENTS_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character';

const normalizeEmail = (email) => {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
};

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


const sendVerificationEmail = async (user, token) => {
    const verifyUrl = `http://localhost:5173/auth/verify-email/${token}`;
    const message = `Please verify your email by clicking on the link: \n\n ${verifyUrl}`;
    try {
        await sendEmail({ email: user.email, subject: 'Email Verification - MediCare System', message });
    } catch (error) {
        console.error('Error sending verification email', error);
    }
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
            const Hospital = require('../models/Hospital');
            const defaultHospital = await Hospital.findOne();
            if (defaultHospital) {
                effectiveHospitalId = defaultHospital._id.toString();
            }
        }

        if (userType === 'staff' && !effectiveHospitalId) {
            return res.status(400).json({ message: 'Hospital ID required for staff registration' });
        }
        if (!isValidEmailDomain(normalizedEmail, userType)) {
            if (userType === 'staff') {
                return res.status(400).json({ message: 'Staff must use hospital email domains: @hospital.com, @healthcare.com, or @medical.com' });
            } else if (userType === 'patient') {
                return res.status(400).json({ message: 'Patients must use personal email domains: @gmail.com, @yahoo.com, @outlook.com, @hotmail.com, @aol.com, or @mail.com' });
            }
        }

        if (!isStrongPassword(password)) {
            return res.status(400).json({ message: PASSWORD_REQUIREMENTS_MESSAGE });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const emailVerificationToken = crypto.createHash('sha256').update(verificationToken).digest('hex');
        const emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;

        // === STAFF REGISTRATION ===
        if (userType === 'staff') {
            if (!role || !['DOCTOR', 'NURSE', 'ADMIN', 'STAFF'].includes(role)) {
                return res.status(400).json({ message: 'Valid role required for staff' });
            }

            const parsedYearsOfExperience =
                yearsOfExperience === undefined || yearsOfExperience === null || yearsOfExperience === ''
                    ? undefined
                    : Number.parseInt(yearsOfExperience, 10);

            if (role.toLowerCase() === 'doctor' && parsedYearsOfExperience !== undefined && Number.isNaN(parsedYearsOfExperience)) {
                return res.status(400).json({ message: 'Years of experience must be a valid number' });
            }

            // Doctors require admin approval, other staff are active immediately
            const Status = role.toLowerCase() === 'doctor' ? 'pending' : 'active';

            const newUser = new User({
                name,
                email: normalizedEmail,
                password: hashedPassword,
                emailVerificationToken,
                emailVerificationExpires,
                role: role.toLowerCase(),
                status: Status, // Doctors pending, others active
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
                            link: role.toLowerCase() === 'doctor' ? '/admin/pending-approvals' : '/admin/doctors'
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
            await sendVerificationEmail(newUser, verificationToken);
            return res.status(201).json({ 
                message: 'Staff registration successful',
                userId: newUser._id
            });
        }

        // === PATIENT REGISTRATION ===
        if (userType === 'patient') {
            let patientRecord;
            const patientCard = generatePatientCard();

            // Case 1: Link to existing patient record
            if (existingPatientId) {
                const existing = await Patient.findById(existingPatientId);
                if (!existing) {
                    return res.status(404).json({ message: 'Patient record not found' });
                }

                // Create user linked to existing patient
                const newUser = new User({
                    name,
                    email: normalizedEmail,
                    password: hashedPassword,
                emailVerificationToken,
                emailVerificationExpires,
                    role: 'patient',
                    status: 'active', // Patients active immediately
                    hospitalId: effectiveHospitalId ? new mongoose.Types.ObjectId(effectiveHospitalId) : undefined,
                    patientCardNumber: existing.patientCardNumber
                });
                await newUser.save();

                // Update patient record to mark as linked/registered
                existing.status = 'active';
                existing.registrationStatus = 'existing_linked';
                existing.phone = phone || existing.phone;
                existing.gender = gender || existing.gender;
                existing.bloodGroup = bloodGroup || existing.bloodGroup;
                await existing.save();

                await sendVerificationEmail(newUser, verificationToken);
            return res.status(201).json({
                    message: 'Registration successful! You can now access your medical records.',
                    userId: newUser._id,
                    patientCardNumber: existing.patientCardNumber,
                    status: 'active'
                });
            }

            // Case 2: Create new patient record
            const newUser = new User({
                name,
                email: normalizedEmail,
                password: hashedPassword,
                emailVerificationToken,
                emailVerificationExpires,
                role: 'patient',
                status: 'pending', // Patients pending admin verification
                hospitalId: effectiveHospitalId ? new mongoose.Types.ObjectId(effectiveHospitalId) : undefined,
                patientCardNumber: patientCard
            });
            await newUser.save();

            // Create corresponding patient record
            patientRecord = new Patient({
                userId: newUser._id,
                patientCardNumber: patientCard,
                status: 'pending',
                registrationStatus: 'self_registered',
                phone: phone || '',
                gender: gender || '',
                age: age || null,
                bloodGroup: bloodGroup || ''
            });
            await patientRecord.save();

            // Notify hospital admins
            if (effectiveHospitalId) {
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
            }

            await sendVerificationEmail(newUser, verificationToken);
            return res.status(201).json({
                message: 'Registration successful! Your profile is pending admin verification. You will be notified once approved.',
                userId: newUser._id,
                patientCardNumber: patientCard,
                status: 'pending'
            });
        }

        return res.status(400).json({ message: 'Invalid user type. Must be "staff" or "patient"' });

    } catch (error) {
        return res.status(500).json({
            message: 'Server error',
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

        // Multi-tenant user lookup: find user by email and hospital (if provided)
        const query = { email: normalizedEmail };
        if (hospitalId) {
            query.hospitalId = new mongoose.Types.ObjectId(hospitalId);
        }

        const existingUser = await User.findOne(query).select('+password');

        if (!existingUser) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        if (typeof existingUser.password !== 'string' || existingUser.password.length === 0) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, existingUser.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }

        // Check if patient is approved
        if (existingUser.role === 'patient' && existingUser.status === 'pending') {
            return res.status(403).json({ message: 'Your account is pending admin approval. Please check back soon.' });
        }

        if (existingUser.role === 'patient' && existingUser.status === 'rejected') {
            return res.status(403).json({ message: 'Your registration has been rejected. Please contact hospital administration.' });
        }

        if (existingUser.status === 'inactive') {
            return res.status(403).json({ message: 'Your account has been deactivated. Please contact hospital administration.' });
        }

        // Create JWT with multi-tenant context
        const token = jwt.sign({
            userId: existingUser._id,
            email: existingUser.email,
            role: existingUser.role,
            hospitalId: existingUser.hospitalId,
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
        const { email } = req.body;
        const user = await User.findOne({ email: normalizeEmail(email) });
        if (!user) { return res.status(404).json({ message: 'There is no user with that email address.' }); }
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
        await user.save({ validateBeforeSave: false });
        const resetUrl = `http://localhost:5173/auth/reset-password/${resetToken}`;
        const message = `Forgot your password? Reset it here: \n\n ${resetUrl}`;
        try {
            await sendEmail({ email: user.email, subject: 'Your password reset token', message });
            res.status(200).json({ message: 'Token sent to email!' });
        } catch (error) {
            user.resetPasswordToken = undefined; user.resetPasswordExpires = undefined;
            await user.save({ validateBeforeSave: false });
            return res.status(500).json({ message: 'There was an error sending the email.' });
        }
    } catch (error) { res.status(500).json({ message: 'Server error', error: error.message }); }
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
