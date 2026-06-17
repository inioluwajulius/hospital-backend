const MedicalRecord = require('../models/MedicalRecord');
const Patient = require('../models/Patient');

exports.createMedicalRecord = async (req, res) => {
    try {
        const recordData = { ...req.body };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            recordData.hospitalId = req.tenantFilter.hospitalId;
        }
        
        // Force doctorId if requester is a doctor
        if (req.user && req.user.role === 'doctor') {
            recordData.doctorId = req.user.userId;
        }

        const record = new MedicalRecord(recordData);
        await record.save();

        const populatedRecord = await MedicalRecord.findById(record._id)
            .populate('doctorId', 'name specialization')
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });

        res.status(201).json({ success: true, data: populatedRecord });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getPatientRecords = async (req, res) => {
    try {
        let query = { patientId: req.params.patientId };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const records = await MedicalRecord.find(query)
            .populate('doctorId', 'name specialization')
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });

        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAllRecords = async (req, res) => {
    try {
        let query = {};
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }
        
        if (req.user && req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json({ success: true, data: [] });
            query.patientId = patientRecord._id;
        } else if (req.user && req.user.role === 'doctor') {
            query.doctorId = req.user.userId;
        }
        
        const records = await MedicalRecord.find(query)
            .populate('doctorId', 'name specialization')
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } });
            
        res.json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
