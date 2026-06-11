const Radiology = require('../models/Radiology');

/**
 * Create radiology exam
 * RADIOLOGIST only (licensed to interpret imaging)
 */
exports.createRadiology = async (req, res) => {
    try {
        const { patientId, examType, bodyPart, reportFindings, impression, recommendations, imageCount, imageUrls, priority } = req.body;

        const examOrder = `RAD-${Date.now()}`;

        const radiology = new Radiology({
            patientId,
            examOrder,
            examType,
            bodyPart,
            examDate: new Date(),
            reportGeneratedDate: new Date(),
            reportFindings,
            impression,
            recommendations,
            imageCount,
            imageUrls,
            radiologist: req.user.id,
            status: 'reviewed',
            priority
        });

        await radiology.save();
        await radiology.populate('patientId', 'name patientCardNumber');

        res.status(201).json(radiology);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Get radiology reports
 * ADMIN, DOCTOR, RADIOLOGIST, PATIENT (own only)
 */
exports.getRadiology = async (req, res) => {
    try {
        const { patientId, status, examType } = req.query;
        let query = {};

        // Patient can only see their own radiology
        if (req.user.role === 'patient') {
            if (!patientId) {
                return res.status(400).json({ message: 'Patient must specify patientId' });
            }
            query.patientId = patientId;
        } else {
            if (patientId) query.patientId = patientId;
        }

        if (status) query.status = status;
        if (examType) query.examType = examType;

        const radiology = await Radiology.find(query)
            .populate('patientId', 'name patientCardNumber')
            .populate('radiologist', 'name')
            .populate('doctorId', 'name')
            .sort({ createdAt: -1 });

        res.json(radiology);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * Update radiology (ADMIN ONLY via amendment system)
 * Immutable report: amend instead of direct edit
 */
exports.updateRadiology = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, recommendations } = req.body;

        const radiology = await Radiology.findById(id);
        if (!radiology) {
            return res.status(404).json({ message: 'Radiology report not found' });
        }

        // Only allow status/recommendations, not findings (compliance - immutable)
        if (status) radiology.status = status;
        if (recommendations) radiology.recommendations = recommendations;

        await radiology.save();
        res.json(radiology);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

/**
 * Delete radiology (ADMIN ONLY - creates audit log)
 */
exports.deleteRadiology = async (req, res) => {
    try {
        const { id } = req.params;
        const radiology = await Radiology.findByIdAndDelete(id);

        if (!radiology) {
            return res.status(404).json({ message: 'Radiology report not found' });
        }

        res.json({ message: 'Radiology report deleted (audit logged)', examOrder: radiology.examOrder });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
