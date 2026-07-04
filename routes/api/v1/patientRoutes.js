const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createPatient, getPatients, updatePatient, deletePatient, searchPatients, updatePatientProfile } = require('../../../controllers/patientController');

/**
 * @route   GET /api/v1/patients
 * @desc    Get all patients (requires authentication)
 * @access  Private
 */
router.get('/', authMiddleware, getPatients);

/**
 * @route   GET /api/v1/patients/search/existing
 * @desc    Search for existing patients (for linking during registration)
 * @access  Public
 */
router.get('/search/existing', searchPatients);



/**
 * @route   POST /api/v1/patients
 * @desc    Create new patient registration (admin or receptionist)
 * @access  Private
 */
router.post('/', authMiddleware, authorize('admin', 'receptionist'), createPatient);

/**
 * @route   PUT /api/v1/patients/profile
 * @desc    Patient updates their own profile
 * @access  Private - Patient only
 */
router.put('/profile', authMiddleware, authorize('patient'), updatePatientProfile);

/**
 * @route   PUT /api/v1/patients/:id
 * @desc    Update patient information (audit tracked)
 * @access  Private - Admin/Doctor/Nurse/Receptionist
 */
router.put('/:id', authMiddleware, authorize('admin', 'doctor', 'nurse', 'receptionist'), updatePatient);



/**
 * @route   DELETE /api/v1/patients/:id
 * @desc    Delete patient (audit tracked)
 * @access  Private - Admin only
 */
router.delete('/:id', authMiddleware, authorize('admin'), deletePatient);

module.exports = router;
