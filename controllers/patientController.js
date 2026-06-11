const Patient = require('../models/Patient');
const User = require('../models/User');

exports.createPatient = async (req, res) => {
    try {
        const newPatient = new Patient(req.body);
        const savedPatient = await newPatient.save();
        res.status(201).json(savedPatient);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getPatients = async (req, res) => {
    try {
        const patients = await Patient.find().populate('userId', 'name email');
        res.json(patients);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });

    }
};

exports.updatePatient = async (req, res) => {
    try {
        const updatedPatient = await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedPatient) {
            return res.status(404).json({ message: 'Patient not found' });
        }
        res.json(updatedPatient);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.deletePatient = async (req, res) => {
    try {
        const deletedPatient = await Patient.findByIdAndDelete(req.params.id);
        if (!deletedPatient) {
            return res.status(404).json({ message: 'Patient not found' });
        }
        res.json({ message: 'Patient deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Search for existing patients (for linking during registration)
exports.searchPatients = async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.trim().length === 0) {
            return res.status(400).json({ message: 'Search query is required' });
        }

        // Search by name, patient ID, or phone
        const patients = await Patient.find({
            $or: [
                { patientCardNumber: new RegExp(query, 'i') },
                { phone: new RegExp(query, 'i') }
            ]
        }).populate('userId', 'name email').select('-userId.password');

        res.json(patients);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Get pending patient registrations (admin only)
exports.getPendingPatients = async (req, res) => {
    try {
        const pendingPatients = await Patient.find({ status: 'pending' })
            .populate('userId', 'name email createdAt')
            .sort({ createdAt: -1 });

        res.json(pendingPatients);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Approve patient registration (admin only)
exports.approvePatientRegistration = async (req, res) => {
    try {
        const { patientId } = req.params;
        const { notes } = req.body;

        const patient = await Patient.findByIdAndUpdate(
            patientId,
            { 
                status: 'active',
                approvedAt: new Date(),
                approvalNotes: notes || ''
            },
            { new: true }
        ).populate('userId', 'name email');

        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        // Update corresponding user status
        await User.findByIdAndUpdate(patient.userId._id, { status: 'active' });

        res.json({ 
            message: 'Patient approved successfully', 
            patient 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Reject patient registration (admin only)
exports.rejectPatientRegistration = async (req, res) => {
    try {
        const { patientId } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const patient = await Patient.findByIdAndUpdate(
            patientId,
            { 
                status: 'rejected',
                rejectionReason: reason,
                rejectedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'name email');

        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }

        // Update corresponding user status
        await User.findByIdAndUpdate(patient.userId._id, { status: 'rejected' });

        res.json({ 
            message: 'Patient registration rejected', 
            patient 
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};