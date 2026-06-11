const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createDoctor, getDoctors, updateDoctor, deleteDoctor } = require('../../../controllers/doctorController');

/**
 * @route   GET /api/v1/doctors
 * @desc    Get all doctors (doctors, admin, receptionist can view)
 * @access  Private
 */
router.get('/', authMiddleware, authorize('admin', 'doctor', 'receptionist'), getDoctors);

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
router.put('/:id', authMiddleware, authorize('admin'), updateDoctor);

/**
 * @route   DELETE /api/v1/doctors/:id
 * @desc    Delete doctor (audit tracked)
 * @access  Private - Admin only
 */
router.delete('/:id', authMiddleware, authorize('admin'), deleteDoctor);

module.exports = router;
