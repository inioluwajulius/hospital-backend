const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createPrescription, getPrescriptions, updatePrescription, deletePrescription } = require('../controllers/prescriptionController');

// GET - Read prescriptions (admin, doctor, pharmacist, patient reads own)
router.get('/', authMiddleware, authorize('admin', 'doctor', 'pharmacist', 'patient'), getPrescriptions);

// POST - Create prescription (doctor only - licensed prescriber)
router.post('/', authMiddleware, authorize('doctor'), createPrescription);

// PUT - Update prescription (ADMIN ONLY via amendment system - NEVER direct edit)
router.put('/:id', authMiddleware, authorize('admin'), updatePrescription);

// DELETE - Revoke prescription (ADMIN ONLY - creates amendment record)
router.delete('/:id', authMiddleware, authorize('admin'), deletePrescription);

module.exports = router;