const User = require("../models/User");
const Patient = require("../models/Patient");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

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

exports.register = async (req, res) => {
    try {
        const { name, email, password, userType, role, phone, age, gender, bloodGroup, existingPatientId, specialization, licenseNumber, yearsOfExperience, hospitalId } = req.body || {};
        const normalizedEmail = normalizeEmail(email);

        // Validate basic fields
        if (!name || !normalizedEmail || !password || !userType) {
            return res.status(400).json({ message: 'Name, email, password, and user type are required' });
        }

        let effectiveHospitalId = hospitalId || req.tenant?.id || req.tenant?.hospital?._id;
        if (!effectiveHospitalId && userType === 'staff') {
            const Hospital = require('../models/Hospital');
            const defaultHospital = await Hospital.findOne();
            if (defaultHospital) {
                effectiveHospitalId = defaultHospital._id.toString();
            }
        }

        // For staff: hospitalId is required
        if (userType === 'staff' && !effectiveHospitalId) {
            return res.status(400).json({ message: 'Hospital ID required for staff registration' });
        }

        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ message: 'Invalid email format' });
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
                role: role.toLowerCase(),
                status: Status, // Doctors pending, others active
                hospitalId: effectiveHospitalId ? new mongoose.Types.ObjectId(effectiveHospitalId) : undefined,
                // Doctor-specific fields
                specialization: role.toLowerCase() === 'doctor' ? specialization : undefined,
                licenseNumber: role.toLowerCase() === 'doctor' ? licenseNumber : undefined,
                yearsOfExperience: role.toLowerCase() === 'doctor' ? parsedYearsOfExperience : undefined,
            });
            await newUser.save();

            // Tests expect a generic staff registration success message
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