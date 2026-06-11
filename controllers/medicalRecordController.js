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
