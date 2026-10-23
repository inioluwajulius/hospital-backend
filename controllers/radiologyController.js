const Radiology = require('../models/Radiology');
const Patient = require('../models/Patient');

/**
 * Build the patientId condition that limits radiology reports to what the
 * caller may see. Reports are scoped through their patient, so this also
 * covers reports created before Radiology had a hospitalId.
 * Returns null when the caller may not see the requested patient.
 */
const patientScope = async (req, requestedPatientId) => {
    if (req.user.role === 'patient') {
        const own = await Patient.findOne({ userId: req.user.userId, ...(req.tenantFilter || {}) }).select('_id');
        if (!own) return null;
        if (requestedPatientId && String(requestedPatientId) !== String(own._id)) return null;
        return own._id;
    }

    if (!req.tenantFilter?.hospitalId) {
        // Super admin across all hospitals
        return requestedPatientId || undefined;
    }

    if (requestedPatientId) {
        const patient = await Patient.findOne({ _id: requestedPatientId, hospitalId: req.tenantFilter.hospitalId }).select('_id');
        return patient ? patient._id : null;
    }

    const ids = await Patient.find({ hospitalId: req.tenantFilter.hospitalId }).distinct('_id');
    return { $in: ids };
};

const findScopedRadiology = async (req, id) => {
    const radiology = await Radiology.findById(id);
    if (!radiology) return null;
    const scope = await patientScope(req, radiology.patientId);
    return scope ? radiology : null;
};

/**
 * Create radiology exam
 * DOCTOR places an order (status "ordered"); RADIOLOGIST files a reviewed report
 */
exports.createRadiology = async (req, res) => {
    try {
        const { patientId, examType, bodyPart, reportFindings, impression, recommendations, imageCount, imageUrls, priority } = req.body;

        const scope = await patientScope(req, patientId);
        if (!patientId || !scope) {
            return res.status(404).json({ message: 'Patient not found in this hospital' });
        }

        const examOrder = `RAD-${Date.now()}`;

        const isOrder = req.user.role === 'doctor';
        const radiology = new Radiology(isOrder ? {
            patientId,
            hospitalId: req.tenantFilter?.hospitalId,
            examOrder,
            examType,
            bodyPart,
            doctorId: req.user.userId,
            status: 'ordered',
            priority
        } : {
            patientId,
            hospitalId: req.tenantFilter?.hospitalId,
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
            radiologist: req.user.userId,
            status: 'reviewed',
            priority
        });

        await radiology.save();
        await radiology.populate({ path: 'patientId', select: 'userId name patientCardNumber', populate: { path: 'userId', select: 'name' } });

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

        // Patients only see their own reports; staff only see their hospital's patients
        const scope = await patientScope(req, typeof patientId === 'string' ? patientId : undefined);
        if (scope === null) {
            return res.json([]);
        }
        if (scope !== undefined) query.patientId = scope;

        if (typeof status === 'string') query.status = status;
        if (typeof examType === 'string') query.examType = examType;

        const radiology = await Radiology.find(query)
            .populate({ path: 'patientId', select: 'userId name patientCardNumber', populate: { path: 'userId', select: 'name' } })
            .populate('radiologist', 'name')
            .populate('doctorId', 'name')
            .sort({ createdAt: -1 });

        res.json(radiology);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * File the report for an ordered exam (RADIOLOGIST)
 * Once reviewed, the findings are immutable.
 */
exports.fileRadiologyReport = async (req, res) => {
    try {
        const { reportFindings, impression, recommendations, imageCount, imageUrls } = req.body;
        if (!reportFindings || !impression) {
            return res.status(400).json({ message: 'Findings and impression are required' });
        }

        const radiology = await findScopedRadiology(req, req.params.id);
        if (!radiology) {
            return res.status(404).json({ message: 'Radiology exam not found' });
        }
        if (radiology.status === 'reviewed' || radiology.status === 'completed') {
            return res.status(400).json({ message: 'This exam already has a report' });
        }

        Object.assign(radiology, {
            reportFindings,
            impression,
            recommendations,
            imageCount,
            imageUrls,
            radiologist: req.user.userId,
            examDate: radiology.examDate || new Date(),
            reportGeneratedDate: new Date(),
            status: 'reviewed',
        });
        await radiology.save();
        res.json(radiology);
    } catch (error) {
        res.status(400).json({ message: error.message });
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

        const radiology = await findScopedRadiology(req, id);
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
        const radiology = await findScopedRadiology(req, id);

        if (!radiology) {
            return res.status(404).json({ message: 'Radiology report not found' });
        }

        await radiology.deleteOne();

        res.json({ message: 'Radiology report deleted (audit logged)', examOrder: radiology.examOrder });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
