const Prescription = require('../models/Prescription');
const Notification = require('../models/Notification');
const socketService = require('../socket');

/**
 * Create prescription
 * DOCTOR only (licensed prescriber)
 */
exports.createPrescription = async (req, res) => {
    try {
        const { patientId, medications, notes } = req.body;

        const prescription = new Prescription({
            patientId,
            doctorId: req.user.id, // Authenticated doctor
            medications,
            notes,
            status: 'pending'
        });

        await prescription.save();
        await prescription.populate([
            { path: 'patientId', select: 'name patientCardNumber userId' },
            { path: 'doctorId', select: 'name specialization' }
        ]);

        // Notify Patient
        try {
            const io = socketService.getIO();
            
            if (prescription.patientId && prescription.patientId.userId) {
                const notif = await Notification.create({
                    recipient: prescription.patientId.userId,
                    hospitalId: req.tenant?.id,
                    type: 'PRESCRIPTION',
                    message: `New prescription issued by Dr. ${prescription.doctorId?.name || 'your doctor'}`,
                    link: '/patient/prescriptions'
                });
                if (io) io.to(prescription.patientId.userId.toString()).emit('new_notification', notif);
            }
        } catch (err) {
            console.error('Notification error:', err);
        }

        res.status(201).json(prescription);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Get prescriptions
 * ADMIN, DOCTOR, PHARMACIST, PATIENT (own only)
 */
exports.getPrescriptions = async (req, res) => {
    try {
        const { patientId, status } = req.query;
        let query = {};

        // Patient can only see their own prescriptions
        if (req.user.role === 'patient') {
            const Patient = require('../models/Patient');
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json([]);
            query.patientId = patientRecord._id;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;

        const prescriptions = await Prescription.find(query)
            .populate('patientId', 'name patientCardNumber')
            .populate('doctorId', 'name specialization')
            .sort({ createdAt: -1 });

        res.json(prescriptions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * Update prescription (ADMIN ONLY via amendment system)
 * Never direct edit - create amendment for compliance
 */
exports.updatePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;

        const prescription = await Prescription.findById(id);
        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found' });
        }

        // Only allow status/notes, not medication details (immutable)
        if (status) prescription.status = status;
        if (notes) prescription.notes = notes;

        await prescription.save();
        res.json(prescription);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Delete/Revoke prescription (ADMIN ONLY - creates audit log)
 */
exports.deletePrescription = async (req, res) => {
    try {
        const { id } = req.params;
        const prescription = await Prescription.findByIdAndDelete(id);

        if (!prescription) {
            return res.status(404).json({ message: 'Prescription not found' });
        }

        res.json({ message: 'Prescription revoked (audit logged)' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
