const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const { getPendingUsers, approveUser, rejectUser } = require('../controllers/userController');

// GET - Get all pending users (doctors awaiting approval) - admin only
router.get('/registrations/pending', authMiddleware, authorize('admin'), getPendingUsers);

// PUT - Approve pending user registration (admin only)
router.put('/:userId/approve', authMiddleware, authorize('admin'), approveUser);

// PUT - Reject pending user registration (admin only)
router.put('/:userId/reject', authMiddleware, authorize('admin'), rejectUser);

module.exports = router;
