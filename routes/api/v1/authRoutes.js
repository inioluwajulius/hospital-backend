const express = require('express');
const router = express.Router();

const { register, login } = require('../../../controllers/authController');
const authMiddleware = require('../../../middleware/authMiddleware');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user (patient or doctor)
 * @access  Public
 */
router.post('/register', register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    User login
 * @access  Public
 */
router.post('/login', login);

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
