const express = require('express');
const router = express.Router();
const authMiddleware = require('../../../middleware/authMiddleware');
const authorize = require('../../../middleware/roleMiddleware');
const { getPendingUsers, getRegistration, approveUser, rejectUser } = require('../../../controllers/userController');

// Staff applications awaiting approval. 'admin' = hospital admins (own hospital) and the
// super admin; the controller scopes every query to the hospital.
router.get('/registrations/pending', authMiddleware, authorize('admin'), getPendingUsers);
router.get('/registrations/:userId', authMiddleware, authorize('admin'), getRegistration);

// Decide on a pending application (atomic: only a still-pending application changes)
router.put('/:userId/approve', authMiddleware, authorize('admin'), approveUser);
router.put('/:userId/reject', authMiddleware, authorize('admin'), rejectUser);

module.exports = router;
