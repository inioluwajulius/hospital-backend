const MedicalRecord = require('../models/MedicalRecord');

exports.createMedicalRecord = async (req, res) => {
    try {
        const record = new MedicalRecord(req.body);
        await record.save();

        const populatedRecord = await MedicalRecord.findById(record._id)
            .populate('doctorId')
            .populate('patientId');

        res.status(201).json(populatedRecord);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getPatientRecords = async (req, res) => {
    try {
        const records = await MedicalRecord.find({ patientId: req.params.patientId })
            .populate('doctorId')
            .populate('patientId');

        res.json(records);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllRecords = async (req, res) => {
    try {
        let query = {};
        if (req.user && req.user.role === 'patient') {
            const Patient = require('../models/Patient');
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json([]);
            query.patientId = patientRecord._id;
        }
        const records = await MedicalRecord.find(query)
            .populate('doctorId')
            .populate('patientId');
        res.json(records);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
