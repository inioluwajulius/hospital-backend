const User = require('../models/User');
const bcrypt = require('bcryptjs');

const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Fields an admin may change on a doctor account. Anything else in the body
// (role, hospitalId, isSuperAdmin, password, ...) is ignored.
const UPDATABLE_DOCTOR_FIELDS = ['name', 'phone', 'specialization', 'department', 'licenseNumber', 'yearsOfExperience', 'status'];

exports.createDoctor = async (req, res) => {
    try {
        const { name, email, phone, specialization, department, licenseNumber, experience, password } = req.body;
        
        if (!req.tenantFilter || !req.tenantFilter.hospitalId) {
            return res.status(403).json({ message: 'Hospital context required' });
        }

        if (!password || !STRONG_PASSWORD.test(password)) {
            return res.status(400).json({ message: 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character' });
        }

        // Check if user already exists in this hospital
        const existingUser = await User.findOne({ email, hospitalId: req.tenantFilter.hospitalId });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const newDoctor = new User({
            name,
            email,
            phone,
            password: await bcrypt.hash(password, 10),
            role: 'doctor',
            userType: 'staff',
            status: 'active', // Admin creates them directly as active
            hospitalId: req.tenantFilter.hospitalId,
            specialization,
            department,
            licenseNumber,
            yearsOfExperience: experience
        });

        await newDoctor.save();

        res.status(201).json({
            success: true,
            message: 'Doctor created successfully',
            data: {
                _id: newDoctor._id,
                name: newDoctor.name,
                email: newDoctor.email,
                role: newDoctor.role,
                status: newDoctor.status
            }
        });
    } catch (error) {
        console.error('Error creating doctor:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getDoctors = async (req, res) => {
    try {
        const query = { role: 'doctor' };
        
        // Multi-tenant isolation: fetch doctors for this hospital OR doctors with no hospital assigned
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.$or = [
                { hospitalId: req.tenantFilter.hospitalId },
                { hospitalId: { $exists: false } },
                { hospitalId: null }
            ];
        }

        const doctors = await User.find(query).select('-password -__v -emailVerificationToken -resetPasswordToken');
        
        res.json({
            success: true,
            data: doctors
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateDoctor = async (req, res) => {
    try {
        const query = { _id: req.params.id, role: 'doctor' };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const updates = {};
        for (const field of UPDATABLE_DOCTOR_FIELDS) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        const doctor = await User.findOneAndUpdate(query, updates, { new: true, runValidators: true }).select('-password');
        
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found in this hospital' });
        }
        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.deleteDoctor = async (req, res) => {
    try {
        const query = { _id: req.params.id, role: 'doctor' };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const doctor = await User.findOneAndDelete(query);
        if (!doctor) {
            return res.status(404).json({ message: 'Doctor not found in this hospital' });
        }
        res.json({ success: true, message: 'Doctor removed successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

