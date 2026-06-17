const express = require('express');
const router = express.Router();

const { register, login, verifyEmail, forgotPassword, resetPassword } = require('../../../controllers/authController');
const authMiddleware = require('../../../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiting for auth routes to prevent brute force attacks
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user (patient or doctor)
 * @access  Public
 */
router.post('/register', authLimiter, register);

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
router.get('/me', authMiddleware, (req, res) => {
    try {
        res.json({
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            role: req.user.role
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user info', error: error.message });
    }
});

module.exports = router;
