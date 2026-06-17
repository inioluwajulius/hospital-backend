const Prescription = require('../models/Prescription');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const Patient = require('../models/Patient');
const User = require('../models/User');

exports.createPrescription = async (req, res) => {
    try {
        const { patientId, medications, notes } = req.body;
        
        const prescriptionData = {
            patientId,
            doctorId: req.user.userId, // Authenticated doctor
            medications,
            notes,
            status: 'pending'
        };

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            prescriptionData.hospitalId = req.tenantFilter.hospitalId;
        }

        const prescription = new Prescription(prescriptionData);

        await prescription.save();
        await prescription.populate([
            { path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } },
            { path: 'doctorId', select: 'name specialization' }
        ]);

        // Notify Patient
        try {
            const io = socketService.getIO();
            
            if (prescription.patientId && prescription.patientId.userId) {
                const notif = await Notification.create({
                    recipient: prescription.patientId.userId._id || prescription.patientId.userId,
                    hospitalId: req.tenantFilter?.hospitalId || prescription.hospitalId,
                    type: 'PRESCRIPTION',
                    message: `New prescription issued by Dr. ${prescription.doctorId?.name || 'your doctor'}`,
                    link: '/patient/prescriptions'
                });
                if (io) io.to(notif.recipient.toString()).emit('new_notification', notif);
            }
        } catch (err) {
            console.error('Notification error:', err);
        }

        res.status(201).json({ success: true, data: prescription });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.getPrescriptions = async (req, res) => {
    try {
        const { patientId, status } = req.query;
        let query = {};

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        if (req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json({ success: true, data: [] });
            query.patientId = patientRecord._id;
        } else if (req.user.role === 'doctor') {
            query.doctorId = req.user.userId;
            if (patientId) query.patientId = patientId;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;

        const prescriptions = await Prescription.find(query)
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } })
            .populate('doctorId', 'name specialization')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: prescriptions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updatePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const prescription = await Prescription.findOne(query);
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found' });
        }

        if (status) prescription.status = status;
        if (notes) prescription.notes = notes;

        await prescription.save();
        res.json({ success: true, data: prescription });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.deletePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const prescription = await Prescription.findOneAndDelete(query);
        if (!prescription) {
            return res.status(404).json({ success: false, message: 'Prescription not found' });
        }

        res.json({ success: true, message: 'Prescription revoked' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
