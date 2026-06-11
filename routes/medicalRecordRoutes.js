const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');

const { createMedicalRecord, getPatientRecords } = require('../controllers/medicalRecordController');

// GET - Read a patient's medical records (admin, doctor, nurse)
router.get('/patient/:patientId', authMiddleware, authorize('admin', 'doctor', 'nurse'), getPatientRecords);

// POST - Create medical record (doctor only)
router.post('/', authMiddleware, authorize('doctor'), createMedicalRecord);

module.exports = router;
