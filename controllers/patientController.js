const Patient = require('../models/Patient');
const User = require('../models/User');

exports.createPatient = async (req, res) => {
    try {
        const payload = { ...req.body };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            payload.hospitalId = req.tenantFilter.hospitalId;
        }

        const newPatient = new Patient(payload);
        const savedPatient = await newPatient.save();
        res.status(201).json(savedPatient);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.getPatients = async (req, res) => {
    try {
        const query = {};
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const patients = await Patient.find(query).populate('userId', 'name email status');
        res.json({ success: true, data: patients });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updatePatient = async (req, res) => {
    try {
        const query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const updatedPatient = await Patient.findOneAndUpdate(query, req.body, { new: true });
        if (!updatedPatient) {
            return res.status(404).json({ message: 'Patient not found in this hospital' });
        }
        res.json({ success: true, data: updatedPatient });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.deletePatient = async (req, res) => {
    try {
        const query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const deletedPatient = await Patient.findOneAndDelete(query);
        if (!deletedPatient) {
            return res.status(404).json({ message: 'Patient not found in this hospital' });
        }
        res.json({ success: true, message: 'Patient deleted successfully' });
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

        const dbQuery = {
            $or: [
                { patientCardNumber: new RegExp(query, 'i') },
                { phone: new RegExp(query, 'i') }
            ]
        };

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            dbQuery.hospitalId = req.tenantFilter.hospitalId;
        }

        const patients = await Patient.find(dbQuery).populate('userId', 'name email').select('-userId.password');

        res.json(patients);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
