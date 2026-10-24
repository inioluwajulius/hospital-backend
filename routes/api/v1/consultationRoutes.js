const express = require('express');
const router = express.Router();

const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');
const {
    getConsultation, getMessages, postMessage, startConsultation, completeConsultation, getIceServers,
} = require('../../../controllers/consultationController');

// Telemedicine consultations: only the appointment's doctor and patient (checked per request)
router.use(authMiddleware, authorize('doctor', 'patient'));

router.get('/ice-servers', getIceServers);
router.get('/:id', getConsultation);
router.get('/:id/messages', getMessages);
router.post('/:id/messages', postMessage);
router.post('/:id/start', startConsultation);
router.post('/:id/complete', completeConsultation);

module.exports = router;
