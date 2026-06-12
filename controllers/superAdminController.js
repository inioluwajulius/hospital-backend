const Hospital = require('../models/Hospital');
const User = require('../models/User');
const HospitalAdmin = require('../models/HospitalAdmin');
const SuperAdmin = require('../models/SuperAdmin');
const crypto = require('crypto');
const bcryptjs = require('bcryptjs');

/**
 * SuperAdmin Controller
 * Handles platform-level operations like creating hospitals
 */

// Get all hospitals (SuperAdmin dashboard)
exports.getAllHospitals = async (req, res) => {
    try {
        if (!req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const skip = (page - 1) * limit;

        const hospitals = await Hospital.find()
            .populate('superAdmin', 'name email')
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        const total = await Hospital.countDocuments();

        res.json({
            success: true,
            data: hospitals,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                current: page,
            },
        });
    } catch (error) {
        console.error('getAllHospitals error:', error);
        res.status(500).json({ error: 'Failed to fetch hospitals' });
    }
};

// Create a new hospital
exports.createHospital = async (req, res) => {
    try {
        if (!req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const {
            name,
            slug,
            description,
            subdomain,
            customDomain,
            logo,
            address,
            contact,
            hospitalAdminEmail,
            hospitalAdminName,
            hospitalAdminPassword,
            subscriptionTier,
            maxUsers,
        } = req.body;

        // Validation
        if (!name || !slug || !hospitalAdminEmail || !hospitalAdminName || !hospitalAdminPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['name', 'slug', 'hospitalAdminEmail', 'hospitalAdminName', 'hospitalAdminPassword'],
            });
        }

        // Check if slug is unique
        let existingHospital = await Hospital.findOne({ slug: slug.toLowerCase() });
        if (existingHospital) {
            return res.status(400).json({ error: 'Hospital slug already exists' });
        }

        // Check if subdomain is unique
        if (subdomain) {
            existingHospital = await Hospital.findOne({ subdomain: subdomain.toLowerCase() });
            if (existingHospital) {
                return res.status(400).json({ error: 'Subdomain already taken' });
            }
        }

        // Check if custom domain is unique
        if (customDomain) {
            existingHospital = await Hospital.findOne({ customDomain: customDomain.toLowerCase() });
            if (existingHospital) {
                return res.status(400).json({ error: 'Custom domain already taken' });
            }
        }

        // Create SuperAdmin user for the hospital
        const hashedPassword = await bcryptjs.hash(hospitalAdminPassword, 10);

        const hospitalAdminUser = await User.create({
            name: hospitalAdminName,
            email: hospitalAdminEmail,
            password: hashedPassword,
            role: 'hospital_admin',
            status: 'active',
            hospitalId: null, // Will be set after hospital is created
        });

        // Create Hospital
        const hospital = await Hospital.create({
            name,
            slug: slug.toLowerCase(),
            description,
            subdomain: subdomain?.toLowerCase(),
            customDomain: customDomain?.toLowerCase(),
            logo,
            address,
            contact,
            superAdmin: hospitalAdminUser._id,
            subscriptionTier: subscriptionTier || 'free',
            maxUsers: maxUsers || 50,
        });

        // Update user with hospitalId
        hospitalAdminUser.hospitalId = hospital._id;
        hospitalAdminUser.isSuperAdmin = false; // Hospital admin, not platform super admin
        await hospitalAdminUser.save();

        // Create HospitalAdmin record
        await HospitalAdmin.create({
            userId: hospitalAdminUser._id,
            hospitalId: hospital._id,
            email: hospitalAdminEmail,
            role: 'hospital_admin',
            permissions: {
                createUsers: true,
                editUsers: true,
                deleteUsers: true,
                inviteStaff: true,
                editHospitalSettings: true,
                editBranding: true,
                manageAppointments: true,
                manageBilling: true,
                viewReports: true,
                generateReports: true,
                viewAuditLogs: true,
                manageFeatures: true,
            },
            status: 'active',
            approvedBy: req.user._id,
            approvedAt: new Date(),
        });

        res.status(201).json({
            success: true,
            message: 'Hospital created successfully',
            data: {
                hospital,
                adminUser: {
                    id: hospitalAdminUser._id,
                    name: hospitalAdminUser.name,
                    email: hospitalAdminUser.email,
                },
            },
        });
    } catch (error) {
        console.error('Create hospital error:', error);
        res.status(500).json({ error: 'Failed to create hospital' });
    }
};

// Update hospital settings
exports.updateHospital = async (req, res) => {
    try {
        if (!req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { hospitalId } = req.params;
        const { name, description, logo, address, contact, subscriptionTier, maxUsers, status } = req.body;

        const hospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            {
                name,
                description,
                logo,
                address,
                contact,
                subscriptionTier,
                maxUsers,
                status,
                updatedAt: new Date(),
            },
            { new: true }
        );

        if (!hospital) {
            return res.status(404).json({ error: 'Hospital not found' });
        }

        res.json({
            success: true,
            message: 'Hospital updated successfully',
            data: hospital,
        });
    } catch (error) {
        console.error('updateHospital error:', error);
        res.status(500).json({ error: 'Failed to update hospital' });
    }
};

// Suspend/Activate hospital
exports.updateHospitalStatus = async (req, res) => {
    try {
        if (!req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { hospitalId } = req.params;
        const { status } = req.body;

        if (!['active', 'inactive', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const hospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            { status },
            { new: true }
        );

        res.json({
            success: true,
            message: `Hospital ${status} successfully`,
            data: hospital,
        });
    } catch (error) {
        console.error('updateHospitalStatus error:', error);
        res.status(500).json({ error: 'Failed to update hospital status' });
    }
};

// Get hospital details
exports.getHospital = async (req, res) => {
    try {
        const { hospitalId } = req.params;

        const hospital = await Hospital.findById(hospitalId).populate('superAdmin', 'name email');

        if (!hospital) {
            return res.status(404).json({ error: 'Hospital not found' });
        }

        res.json({
            success: true,
            data: hospital,
        });
    } catch (error) {
        console.error('getHospital error:', error);
        res.status(500).json({ error: 'Failed to fetch hospital' });
    }
};

// Get hospital statistics
exports.getHospitalStats = async (req, res) => {
    try {
        const { hospitalId } = req.params;

        const userCount = await User.countDocuments({ hospitalId });
        const adminCount = await HospitalAdmin.countDocuments({ hospitalId, status: 'active' });
        const doctors = await User.countDocuments({ hospitalId, role: 'doctor' });
        const patients = await User.countDocuments({ hospitalId, role: 'patient' });

        res.json({
            success: true,
            data: {
                totalUsers: userCount,
                activeAdmins: adminCount,
                doctors,
                patients,
            },
        });
    } catch (error) {
        console.error('getHospitalStats error:', error);
        res.status(500).json({ error: 'Failed to fetch hospital stats' });
    }
};

// Manage hospital features
exports.updateHospitalFeatures = async (req, res) => {
    try {
        if (!req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const { hospitalId } = req.params;
        const { features } = req.body;

        const hospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            { features },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Features updated successfully',
            data: hospital,
        });
    } catch (error) {
        console.error('updateHospitalFeatures error:', error);
        res.status(500).json({ error: 'Failed to update features' });
    }
};

module.exports = exports;
