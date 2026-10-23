const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createRadiology, getRadiology, updateRadiology, deleteRadiology, fileRadiologyReport } = require('../../../controllers/radiologyController');

// GET - Read radiology (admin, doctor, radiologist, patient reads own)
router.get('/', authMiddleware, authorize('admin', 'doctor', 'radiologist', 'patient'), getRadiology);

// POST - Doctors place imaging orders; radiologists file reports
router.post('/', authMiddleware, authorize('doctor', 'radiologist'), createRadiology);

// PUT - Radiologist files the report for an ordered exam
router.put('/:id/report', authMiddleware, authorize('radiologist'), fileRadiologyReport);

// PUT - Update radiology report (ADMIN ONLY via amendment - immutable record)
router.put('/:id', authMiddleware, authorize('admin'), updateRadiology);

// DELETE - Delete radiology (ADMIN ONLY - creates audit/amendment record)
router.delete('/:id', authMiddleware, authorize('admin'), deleteRadiology);

module.exports = router;