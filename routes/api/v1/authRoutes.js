const express = require('express');
const router = express.Router();

const { register, login, verifyEmail, forgotPassword, resetPassword } = require('../../../controllers/authController');
const authMiddleware = require('../../../middleware/authMiddleware');
const User = require('../../../models/User');
const { authLimiter, accountCreationLimiter } = require('../../../middleware/rateLimiter');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user (patient or doctor)
 * @access  Public
 */
router.post('/register', accountCreationLimiter, register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    User login
 * @access  Public
 */
router.post('/login', authLimiter, login);

/**
 * @route   GET /api/v1/auth/verify-email/:token
 * @desc    Verify user email
 * @access  Public
 */
router.get('/verify-email/:token', verifyEmail);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Forgot password email
 * @access  Public
 */
router.post('/forgot-password', authLimiter, forgotPassword);

/**
 * @route   POST /api/v1/auth/reset-password/:token
 * @desc    Reset password
 * @access  Public
 */
router.post('/reset-password/:token', authLimiter, resetPassword);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated user info
 * @access  Private
 */
router.get('/me', authMiddleware, async (req, res) => {
    try {
        // The token only carries id/role, so load name and email from the database
        const user = await User.findById(req.user.userId).select('name email role status hospitalId');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            hospitalId: user.hospitalId
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user info', error: error.message });
    }
});

module.exports = router;
