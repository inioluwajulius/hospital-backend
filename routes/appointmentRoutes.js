const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createAppointment, getAppointments, updateAppointment, deleteAppointment } = require('../controllers/appointmentController');

// GET - Read appointments (public access for testing)
router.get('/', getAppointments);

// POST - Create appointment (admin, receptionist only - appointment desk)
router.post('/', authMiddleware, authorize('admin', 'receptionist'), createAppointment);

// PUT - Update/reschedule appointment (ADMIN ONLY - audit required)
router.put('/:id', authMiddleware, authorize('admin'), updateAppointment);

// DELETE - Cancel appointment (ADMIN ONLY - creates audit log)
router.delete('/:id', authMiddleware, authorize('admin'), deleteAppointment);

module.exports = router;