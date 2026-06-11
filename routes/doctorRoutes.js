const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createDoctor, getDoctors, updateDoctor, deleteDoctor } = require('../controllers/doctorController');

// GET - Read doctors (admin, doctor, receptionist - read-only)
router.get('/', authMiddleware, authorize('admin', 'doctor', 'receptionist'), getDoctors);

// POST - Create doctor (admin only - staff registration)
router.post('/', authMiddleware, authorize('admin'), createDoctor);

// PUT - Update doctor (ADMIN ONLY - audit required)
router.put('/:id', authMiddleware, authorize('admin'), updateDoctor);

// DELETE - Delete doctor (ADMIN ONLY - creates audit log)
router.delete('/:id', authMiddleware, authorize('admin'), deleteDoctor);

module.exports = router;