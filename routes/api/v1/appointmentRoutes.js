const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');

const { createAppointment, getAppointments, updateAppointment, deleteAppointment } = require('../../../controllers/appointmentController');

// GET - Read appointments (secured for all authenticated users)
router.get('/', authMiddleware, getAppointments);

// POST - Create appointment (admin, receptionist, patient)
router.post('/', authMiddleware, authorize('admin', 'receptionist', 'patient'), createAppointment);

// PUT - Update/reschedule/cancel appointment
router.put('/:id', authMiddleware, authorize('admin', 'receptionist', 'patient', 'doctor'), updateAppointment);

// DELETE - Cancel appointment (ADMIN ONLY - creates audit log)
router.delete('/:id', authMiddleware, authorize('admin'), deleteAppointment);

module.exports = router;