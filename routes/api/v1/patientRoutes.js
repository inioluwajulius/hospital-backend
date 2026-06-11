const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createPatient, getPatients, updatePatient, deletePatient, searchPatients, getPendingPatients, approvePatientRegistration, rejectPatientRegistration } = require('../../../controllers/patientController');

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
 * @route   GET /api/v1/patients/registrations/pending
 * @desc    Get all pending patient registrations (admin only)
 * @access  Private - Admin only
 */
router.get('/registrations/pending', authMiddleware, authorize('admin'), getPendingPatients);

/**
 * @route   POST /api/v1/patients
 * @desc    Create new patient registration (admin or receptionist)
 * @access  Private
 */
router.post('/', authMiddleware, authorize('admin', 'receptionist'), createPatient);

/**
 * @route   PUT /api/v1/patients/:id
 * @desc    Update patient information (audit tracked)
 * @access  Private - Admin only
 */
router.put('/:id', authMiddleware, authorize('admin'), updatePatient);

/**
 * @route   PUT /api/v1/patients/:patientId/approve
 * @desc    Approve pending patient registration (admin only)
 * @access  Private - Admin only
 */
router.put('/:patientId/approve', authMiddleware, authorize('admin'), approvePatientRegistration);

/**
 * @route   PUT /api/v1/patients/:patientId/reject
 * @desc    Reject pending patient registration (admin only)
 * @access  Private - Admin only
 */
router.put('/:patientId/reject', authMiddleware, authorize('admin'), rejectPatientRegistration);

/**
 * @route   DELETE /api/v1/patients/:id
 * @desc    Delete patient (audit tracked)
 * @access  Private - Admin only
 */
router.delete('/:id', authMiddleware, authorize('admin'), deletePatient);

module.exports = router;
