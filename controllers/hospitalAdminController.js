const User = require('../models/User');
const Hospital = require('../models/Hospital');
const HospitalAdmin = require('../models/HospitalAdmin');
const crypto = require('crypto');

/**
 * Hospital Admin Controller
 * Handles hospital-level operations like inviting staff, managing users
 */

// Get hospital profile
exports.getHospitalProfile = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        const hospital = await Hospital.findById(hospitalId).populate('superAdmin', 'name email');

        if (!hospital) {
            return res.status(404).json({ error: 'Hospital not found' });
        }

        res.json({
            success: true,
            data: hospital,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update hospital profile
exports.updateHospitalProfile = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;
        const { name, description, logo, address, contact, branding, settings } = req.body;

        // Only hospital admin can update
        const isAdmin = await HospitalAdmin.findOne({
            hospitalId,
            userId: req.user._id,
            status: 'active',
        });

        if (!isAdmin && !req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const hospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            {
                name,
                description,
                logo,
                address,
                contact,
                branding: branding || undefined,
                settings: settings || undefined,
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Hospital profile updated',
            data: hospital,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all staff in hospital
exports.getAllStaff = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        const page = req.query.page || 1;
        const limit = req.query.limit || 10;
        const skip = (page - 1) * limit;
        const role = req.query.role;

        const query = {
            hospitalId,
            role: { $ne: 'patient' },
        };

        if (role) {
            query.role = role;
        }

        const staff = await User.find(query)
            .skip(skip)
            .limit(limit)
            .select('-password')
            .sort({ createdAt: -1 });

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            data: staff,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                current: page,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Invite staff member
exports.inviteStaffMember = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;
        const { email, name, role, department } = req.body;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        if (!email || !name || !role) {
            return res.status(400).json({
                error: 'Missing required fields: email, name, role',
            });
        }

        // Check if user already exists in hospital
        const existingUser = await User.findOne({ email, hospitalId });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists in this hospital' });
        }

        // Generate invitation token
        const invitationToken = crypto.randomBytes(32).toString('hex');
        const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Create user with pending status
        const newUser = await User.create({
            name,
            email,
            password: crypto.randomBytes(16).toString('hex'), // Random temp password
            role,
            hospitalId,
            status: 'pending',
            department,
            invitationToken,
            invitationExpires,
            invitedBy: req.user._id,
            invitationEmail: email,
        });

        // TODO: Send invitation email with link to set password
        // const invitationLink = `${process.env.FRONTEND_URL}/invite/${invitationToken}`;
        // await sendEmail(email, 'Hospital Invitation', { name, invitationLink });

        res.status(201).json({
            success: true,
            message: 'Invitation sent successfully',
            data: {
                id: newUser._id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
                status: newUser.status,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Accept invitation and set password
exports.acceptInvitation = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Find user by invitation token
        const user = await User.findOne({
            invitationToken: token,
            invitationExpires: { $gt: Date.now() },
        }).select('+invitationToken');

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired invitation token' });
        }

        // Set password
        const bcryptjs = require('bcryptjs');
        user.password = await bcryptjs.hash(password, 10);
        user.status = 'active';
        user.invitationToken = undefined;
        user.invitationExpires = undefined;

        await user.save();

        res.json({
            success: true,
            message: 'Invitation accepted. You can now log in.',
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Resend invitation
exports.resendInvitation = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;
        const { userId } = req.params;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        const user = await User.findOne({ _id: userId, hospitalId });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.status !== 'pending') {
            return res.status(400).json({ error: 'User is not in pending status' });
        }

        // Generate new invitation token
        const invitationToken = crypto.randomBytes(32).toString('hex');
        const invitationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        user.invitationToken = invitationToken;
        user.invitationExpires = invitationExpires;

        await user.save();

        res.json({
            success: true,
            message: 'Invitation resent',
            data: { userId: user._id },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get hospital admins
exports.getHospitalAdmins = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        const admins = await HospitalAdmin.find({ hospitalId, status: 'active' })
            .populate('userId', 'name email')
            .select('-permissions');

        res.json({
            success: true,
            data: admins,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Promote user to hospital admin
exports.promoteToAdmin = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;
        const { userId } = req.params;
        const { permissions } = req.body;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        // Check if user exists in hospital
        const user = await User.findOne({ _id: userId, hospitalId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Create HospitalAdmin record
        const hospitalAdmin = await HospitalAdmin.findOneAndUpdate(
            { userId, hospitalId },
            {
                userId,
                hospitalId,
                email: user.email,
                role: 'hospital_admin',
                permissions: permissions || {},
                status: 'active',
                approvedBy: req.user._id,
                approvedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        // Update user role
        user.role = 'hospital_admin';
        await user.save();

        res.json({
            success: true,
            message: 'User promoted to hospital admin',
            data: hospitalAdmin,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Revoke admin privileges
exports.revokeAdminAccess = async (req, res) => {
    try {
        const hospitalId = req.tenant?.hospital?._id;
        const { userId } = req.params;

        if (!hospitalId) {
            return res.status(400).json({ error: 'Hospital context required' });
        }

        await HospitalAdmin.findOneAndUpdate(
            { userId, hospitalId },
            { status: 'inactive' }
        );

        // Update user role
        await User.findByIdAndUpdate(userId, { role: 'doctor' }); // Or appropriate role

        res.json({
            success: true,
            message: 'Admin privileges revoked',
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;
