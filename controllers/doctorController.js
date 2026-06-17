const User = require('../models/User');

exports.createDoctor = async (req, res) => {
    try {
        const { name, email, phone, specialization, department, licenseNumber, experience, password } = req.body;
        
        if (!req.tenantFilter || !req.tenantFilter.hospitalId) {
            return res.status(403).json({ message: 'Hospital context required' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists' });
        }

        const newDoctor = new User({
            name,
            email,
            phone,
            password: password || 'WelcomeDoctor@123', // Default password if none provided
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
        
        // Multi-tenant isolation: only fetch doctors for this hospital
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
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

        const doctor = await User.findOneAndUpdate(query, req.body, { new: true }).select('-password');
        
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

