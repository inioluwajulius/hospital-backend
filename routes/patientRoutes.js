const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createPatient, getPatients, updatePatient, deletePatient, searchPatients } = require('../controllers/patientController');

// GET - Read patients (requires auth)
router.get('/', authMiddleware, getPatients);

// GET - Search patients for linking during registration
router.get('/search/existing', searchPatients);

// POST - Create patient (admin, receptionist only - new patient registration)
router.post('/', authMiddleware, authorize('admin', 'receptionist'), createPatient);

// PUT - Update patient (ADMIN ONLY - audit required for all changes)
router.put('/:id', authMiddleware, authorize('admin'), updatePatient);

// DELETE - Delete patient (ADMIN ONLY - creates audit log, not permanent)
router.delete('/:id', authMiddleware, authorize('admin'), deletePatient);

module.exports = router;