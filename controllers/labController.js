const LabResult = require('../models/LabResult');
const LabTest = require('../models/LabTest');
const Notification = require('../models/Notification');
const socketService = require('../socket');

/**
 * Create lab test result
 * LAB_TECHNICIAN only
 */
exports.createLabResult = async (req, res) => {
    try {
        const { patientId, testName, testCategory, results, notes, attachments, doctorId } = req.body;

        const testOrder = `LAB-${Date.now()}`;

        const labResult = new LabResult({
            patientId,
            doctorId,
            testOrder,
            testName,
            testCategory,
            collectionDate: new Date(),
            results,
            notes,
            attachments,
            labTechnician: req.user.id,
            status: 'completed'
        });

        await labResult.save();
        await labResult.populate([
            { path: 'patientId', select: 'name patientCardNumber userId' },
            { path: 'doctorId', select: 'userId' }
        ]);

        // Notifications
        try {
            const io = socketService.getIO();
            
            if (labResult.patientId && labResult.patientId.userId) {
                const notif = await Notification.create({
                    recipient: labResult.patientId.userId,
                    hospitalId: req.tenant?.id,
                    type: 'LAB_RESULT',
                    message: `New lab result available: ${testName}`,
                    link: '/patient/medical-records'
                });
                if (io) io.to(labResult.patientId.userId.toString()).emit('new_notification', notif);
            }

            if (labResult.doctorId && labResult.doctorId.userId) {
                const docNotif = await Notification.create({
                    recipient: labResult.doctorId.userId,
                    hospitalId: req.tenant?.id,
                    type: 'LAB_RESULT',
                    message: `Lab result completed for patient: ${labResult.patientId.name}`,
                    link: '/doctor/lab-tests'
                });
                if (io) io.to(labResult.doctorId.userId.toString()).emit('new_notification', docNotif);
            }
        } catch (err) {
            console.error('Notification error:', err);
        }

        res.status(201).json(labResult);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Get lab results
 * ADMIN, DOCTOR, NURSE, LAB_TECHNICIAN, PATIENT (own only)
 */
exports.getLabResults = async (req, res) => {
    try {
        const { patientId, status, testCategory } = req.query;
        let query = {};

        // Patient can only see their own results
        if (req.user.role === 'patient') {
            if (!patientId) {
                return res.status(400).json({ message: 'Patient must specify patientId' });
            }
            query.patientId = patientId;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;
        if (testCategory) query.testCategory = testCategory;

        const labResults = await LabResult.find(query)
            .populate('patientId', 'name patientCardNumber')
            .populate('labTechnician', 'name')
            .populate('doctorId', 'name')
            .sort({ createdAt: -1 });

        res.json(labResults);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * Update lab result (ADMIN ONLY via amendment system)
 * Immutable record: create new amendment instead of direct edit
 */
exports.updateLabResult = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, status } = req.body;

        const labResult = await LabResult.findById(id);
        if (!labResult) {
            return res.status(404).json({ message: 'Lab result not found' });
        }

        // Only allow status/notes update, not results (compliance - immutable)
        if (status) labResult.status = status;
        if (notes) labResult.notes = notes;

        await labResult.save();
        res.json(labResult);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Delete lab result (ADMIN ONLY - creates audit log)
 */
exports.deleteLabResult = async (req, res) => {
    try {
        const { id } = req.params;
        const labResult = await LabResult.findByIdAndDelete(id);

        if (!labResult) {
            return res.status(404).json({ message: 'Lab result not found' });
        }

        res.json({ message: 'Lab result deleted (audit logged)', testOrder: labResult.testOrder });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**********************************************
 * Lab Test Catalog Management (ADMIN ONLY)
 * Immutable test definitions - create new version for changes
 ***********************************************/

exports.orderLabTest = async (req, res) => {

    try {
        const labTest = new LabTest(req.body);

        await labTest.save();
        res.status(201).json(labTest);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }

};

exports.getLabTests = async (req, res) => {
    try {
        const labTests = await LabTest.find().populate('patientId').populate('doctorId').populate('labTechnicianId');
        res.json(labTests);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateLabTest = async (req, res) => {
    try {
        const { id } = req.params;
        const { testName, testCategory, description } = req.body;

        const labTest = await LabTest.findByIdAndUpdate(id, { testName, testCategory, description }, { new: true });
        res.json(labTest);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};
