const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createDoctor, getDoctors, updateDoctor, deleteDoctor, updateMyAvailability } = require('../../../controllers/doctorController');

/**
 * @route   GET /api/v1/doctors
 * @desc    Get all doctors (doctors, admin, receptionist can view)
 * @access  Private
 */
router.get('/', authMiddleware, authorize('admin', 'doctor', 'receptionist', 'patient'), getDoctors);

/**
 * @route   POST /api/v1/doctors
 * @desc    Create new doctor (staff registration)
 * @access  Private - Admin only
 */
router.post('/', authMiddleware, authorize('admin'), createDoctor);

/**
 * @route   PUT /api/v1/doctors/:id
 * @desc    Update doctor information (audit tracked)
 * @access  Private - Admin only
 */
/**
 * @route   PUT /api/v1/doctors/me/availability
 * @desc    Doctor sets their weekly consulting hours
 * @access  Private - Doctor
 */
router.put('/me/availability', authMiddleware, authorize('doctor'), updateMyAvailability);

router.put('/:id', authMiddleware, authorize('admin'), updateDoctor);

/**
 * @route   DELETE /api/v1/doctors/:id
 * @desc    Delete doctor (audit tracked)
 * @access  Private - Admin only
 */
router.delete('/:id', authMiddleware, authorize('admin'), deleteDoctor);

module.exports = router;
