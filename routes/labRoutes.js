const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createLabResult, getLabResults, updateLabResult, deleteLabResult, orderLabTest,getLabTests,updateLabTest } = require('../controllers/labController');

// GET - Read lab results (admin, doctor, nurse, lab_technician, patient reads own)
router.get('/', authMiddleware, authorize('admin', 'doctor', 'nurse', 'lab_technician', 'patient'), getLabResults);

// POST - Create lab result (lab_technician only - certified to record results)
router.post('/', authMiddleware, authorize('lab_technician'), createLabResult);

// PUT - Update/correct lab result (ADMIN ONLY via amendment - immutable record)
router.put('/:id', authMiddleware, authorize('admin'), updateLabResult);

// DELETE - Delete lab result (ADMIN ONLY - creates audit/amendment record)
router.delete('/:id', authMiddleware, authorize('admin'), deleteLabResult);

// GET - Read lab tests (admin only)
router.get('/tests', authMiddleware, authorize('admin'), getLabTests);

// POST - Order lab test (admin only)
router.post('/tests', authMiddleware, authorize('admin'), orderLabTest);

// PUT - Update lab test (admin only)
router.put('/tests/:id', authMiddleware, authorize('admin'), updateLabTest);

module.exports = router;