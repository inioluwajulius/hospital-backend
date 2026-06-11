const express = require('express');
const router = express.Router();

const { register, login } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);

// Get current user info
router.get('/user/me', authMiddleware, (req, res) => {
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
