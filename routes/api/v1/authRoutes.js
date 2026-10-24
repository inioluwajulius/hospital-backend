const express = require('express');
const router = express.Router();

const {
    register, login, verifyEmail, forgotPassword, resetPassword,
    verifyEmailCode, resendVerificationCode, verifyResetCode, resetPasswordWithCode,
} = require('../../../controllers/authController');
const authMiddleware = require('../../../middleware/authMiddleware');
const User = require('../../../models/User');
const { updateMe, changePassword, changeEmail } = require('../../../controllers/accountController');
const { authLimiter, accountCreationLimiter, otpSendLimiter, otpVerifyLimiter } = require('../../../middleware/rateLimiter');

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
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify an email address with the 6-digit code sent at registration
 * @access  Public
 */
router.post('/verify-email', otpVerifyLimiter, verifyEmailCode);

/**
 * @route   POST /api/v1/auth/resend-verification-code
 * @desc    Send a new verification code (generic response; per-email cooldown applies)
 * @access  Public
 */
router.post('/resend-verification-code', otpSendLimiter, resendVerificationCode);
router.post('/send-verification-code', otpSendLimiter, resendVerificationCode);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Forgot password email
 * @access  Public
 */
router.post('/forgot-password', otpSendLimiter, forgotPassword);

/**
 * @route   POST /api/v1/auth/verify-reset-code
 * @desc    Exchange a valid reset code for a short-lived, single-use reset token
 * @access  Public
 */
router.post('/verify-reset-code', otpVerifyLimiter, verifyResetCode);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Set a new password using the reset token from verify-reset-code
 * @access  Public
 */
router.post('/reset-password', authLimiter, resetPasswordWithCode);

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
router.put('/me', authMiddleware, updateMe);
router.post('/change-password', authMiddleware, authLimiter, changePassword);
router.post('/change-email', authMiddleware, authLimiter, changeEmail);

router.get('/me', authMiddleware, async (req, res) => {
    try {
        // The token only carries id/role, so load name and email from the database
        const user = await User.findById(req.user.userId).select('name email phone role status hospitalId isEmailVerified mustChangePassword');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            hospitalId: user.hospitalId,
            phone: user.phone,
            isEmailVerified: user.isEmailVerified,
            mustChangePassword: user.mustChangePassword
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user info', error: error.message });
    }
});

module.exports = router;
