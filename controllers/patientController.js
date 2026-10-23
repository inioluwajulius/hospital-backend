const Patient = require('../models/Patient');
const User = require('../models/User');

// Clinical/demographic fields staff may set on a patient record. Ownership fields
// (userId, hospitalId, patientCardNumber) are never taken from the request body.
const EDITABLE_PATIENT_FIELDS = [
    'name', 'email', 'dateOfBirth', 'age', 'gender', 'phone', 'address', 'bloodGroup', 'allergies',
    'medicalHistory', 'currentMedications', 'insurance', 'immunizations', 'status',
];

const pickEditableFields = (body = {}) => {
    const fields = {};
    for (const key of EDITABLE_PATIENT_FIELDS) {
        if (body[key] !== undefined) fields[key] = body[key];
    }
    return fields;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.createPatient = async (req, res) => {
    try {
        const payload = pickEditableFields(req.body);
        if (!req.tenantFilter || !req.tenantFilter.hospitalId) {
            return res.status(400).json({ message: 'Hospital context required' });
        }
        payload.hospitalId = req.tenantFilter.hospitalId;
        payload.registrationStatus = 'new';
        if (typeof payload.email === 'string') payload.email = payload.email.trim().toLowerCase();

        // Walk-in record: the patient can claim it later by registering with this
        // card number and phone number. Retry on the rare card-number collision.
        let savedPatient;
        for (let attempt = 0; attempt < 5 && !savedPatient; attempt++) {
            try {
                payload.patientCardNumber = 'PAT-' + Math.floor(100000 + Math.random() * 900000);
                savedPatient = await new Patient(payload).save();
            } catch (err) {
                if (err.code !== 11000 || attempt === 4) throw err;
            }
        }
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

        if (req.user.role === 'patient') {
            // Patients may only see their own record
            query.userId = req.user.userId;
        } else if (typeof req.query.userId === 'string') {
            query.userId = req.query.userId;
        }

        const patients = await Patient.find(query).populate('userId', 'name email status');
        res.json({ success: true, data: patients });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getPatientById = async (req, res) => {
    try {
        const query = { _id: req.params.id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }
        if (req.user.role === 'patient') {
            query.userId = req.user.userId;
        }
        
        const patient = await Patient.findOne(query).populate('userId', 'name email status');
        if (!patient) {
            return res.status(404).json({ message: 'Patient not found' });
        }
        res.json({ success: true, data: patient });
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

        const updatedPatient = await Patient.findOneAndUpdate(query, pickEditableFields(req.body), { new: true, runValidators: true });
        if (!updatedPatient) {
            return res.status(404).json({ message: 'Patient not found in this hospital' });
        }
        res.json({ success: true, data: updatedPatient });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

exports.updatePatientProfile = async (req, res) => {
    try {
        const query = { userId: req.user.userId };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const patient = await Patient.findOne(query);
        if (!patient) {
            return res.status(404).json({ message: 'Patient profile not found' });
        }

        // Only allow updating safe fields
        const { phone, address, emergencyContact, bloodGroup } = req.body;
        
        if (phone !== undefined) patient.phone = phone;
        if (address !== undefined) patient.address = address;
        if (emergencyContact !== undefined) patient.emergencyContact = emergencyContact;
        if (bloodGroup !== undefined) patient.bloodGroup = bloodGroup;

        await patient.save();
        res.json({ success: true, data: patient });
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
        // Public endpoint used to link an existing hospital record during registration.
        // Requires an exact card number AND phone number for one hospital, and only
        // returns unlinked records with no personal details.
        const { cardNumber, phone } = req.query;
        const hospitalId = req.tenantFilter?.hospitalId;

        if (typeof cardNumber !== 'string' || typeof phone !== 'string' || !cardNumber.trim() || !phone.trim()) {
            return res.status(400).json({ message: 'Card number and phone number are required' });
        }
        if (!hospitalId) {
            return res.status(400).json({ message: 'Please select your hospital' });
        }

        const candidates = await Patient.find({
            hospitalId,
            patientCardNumber: new RegExp(`^${escapeRegex(cardNumber.trim())}$`, 'i'),
            userId: { $exists: false },
        }).select('patientCardNumber phone hospitalId');

        const phoneDigits = phone.replace(/\D/g, '');
        const matches = candidates
            .filter((p) => phoneDigits.length > 0 && String(p.phone || '').replace(/\D/g, '') === phoneDigits)
            .map((p) => ({ _id: p._id, patientCardNumber: p.patientCardNumber, hospitalId: p.hospitalId }));

        res.json(matches);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
