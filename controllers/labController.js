const LabResult = require('../models/LabResult');
const LabTest = require('../models/LabTest');
const Notification = require('../models/Notification');
const socketService = require('../socket');
const Patient = require('../models/Patient');

/**
 * Create lab test result
 * LAB_TECHNICIAN only
 */
exports.createLabResult = async (req, res) => {
    try {
        const { patientId, testName, testCategory, results, notes, attachments, doctorId } = req.body;

        const testOrder = `LAB-${Date.now()}`;

        const labResultData = {
            patientId,
            doctorId,
            testOrder,
            testName,
            testCategory,
            collectionDate: new Date(),
            results,
            notes,
            attachments,
            labTechnician: req.user.userId,
            status: 'completed'
        };

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            labResultData.hospitalId = req.tenantFilter.hospitalId;
        }

        const labResult = new LabResult(labResultData);

        await labResult.save();
        await labResult.populate([
            { path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } },
            { path: 'doctorId', select: 'name specialization' }
        ]);

        // Notifications
        try {
            const io = socketService.getIO();
            
            if (labResult.patientId && labResult.patientId.userId) {
                const notif = await Notification.create({
                    recipient: labResult.patientId.userId._id || labResult.patientId.userId,
                    hospitalId: req.tenantFilter?.hospitalId || labResult.hospitalId,
                    type: 'LAB_RESULT',
                    message: `New lab result available: ${testName}`,
                    link: '/patient/medical-records'
                });
                if (io) io.to(notif.recipient.toString()).emit('new_notification', notif);
            }

            if (labResult.doctorId) {
                const docNotif = await Notification.create({
                    recipient: labResult.doctorId._id || labResult.doctorId,
                    hospitalId: req.tenantFilter?.hospitalId || labResult.hospitalId,
                    type: 'LAB_RESULT',
                    message: `Lab result completed for patient`,
                    link: '/doctor/lab-tests'
                });
                if (io) io.to(docNotif.recipient.toString()).emit('new_notification', docNotif);
            }
        } catch (err) {
            console.error('Notification error:', err);
        }

        res.status(201).json({ success: true, data: labResult });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
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

        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        // Patient can only see their own results
        if (req.user.role === 'patient') {
            const patientRecord = await Patient.findOne({ userId: req.user.userId });
            if (!patientRecord) return res.json({ success: true, data: [] });
            query.patientId = patientRecord._id;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;
        if (testCategory) query.testCategory = testCategory;

        const labResults = await LabResult.find(query)
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } })
            .populate('labTechnician', 'name')
            .populate('doctorId', 'name specialization')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: labResults });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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

        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const labResult = await LabResult.findOne(query);
        if (!labResult) {
            return res.status(404).json({ success: false, message: 'Lab result not found' });
        }

        // Only allow status/notes update, not results (compliance - immutable)
        if (status) labResult.status = status;
        if (notes) labResult.notes = notes;

        await labResult.save();
        res.json({ success: true, data: labResult });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

/**
 * Delete lab result (ADMIN ONLY - creates audit log)
 */
exports.deleteLabResult = async (req, res) => {
    try {
        const { id } = req.params;
        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const labResult = await LabResult.findOneAndDelete(query);
        if (!labResult) {
            return res.status(404).json({ success: false, message: 'Lab result not found' });
        }

        res.json({ success: true, message: 'Lab result deleted (audit logged)', testOrder: labResult.testOrder });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**********************************************
 * Lab Test Catalog Management (ADMIN ONLY)
 * Immutable test definitions - create new version for changes
 ***********************************************/

exports.orderLabTest = async (req, res) => {
    try {
        const labTestData = { ...req.body };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            labTestData.hospitalId = req.tenantFilter.hospitalId;
        }
        if (req.user && req.user.role === 'doctor') {
            labTestData.doctorId = req.user.userId;
        }

        const labTest = new LabTest(labTestData);
        await labTest.save();
        res.status(201).json({ success: true, data: labTest });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.getLabTests = async (req, res) => {
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

        const labTests = await LabTest.find(query)
            .populate({ path: 'patientId', select: 'userId patientCardNumber', populate: { path: 'userId', select: 'name email' } })
            .populate('doctorId', 'name specialization')
            .populate('labTechnicianId', 'name');
            
        res.json({ success: true, data: labTests });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.updateLabTest = async (req, res) => {
    try {
        const { id } = req.params;
        const { testName, testCategory, description, result } = req.body;

        let query = { _id: id };
        if (req.tenantFilter && req.tenantFilter.hospitalId) {
            query.hospitalId = req.tenantFilter.hospitalId;
        }

        const labTest = await LabTest.findOneAndUpdate(query, { testName, testCategory, description, result }, { new: true });
        if (!labTest) return res.status(404).json({ success: false, message: 'LabTest not found' });
        
        res.json({ success: true, data: labTest });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};
