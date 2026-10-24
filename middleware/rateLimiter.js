const rateLimit = require('express-rate-limit');

// General rate limiter for all auth routes (login, forgot password, etc.)
// Limits each IP to 15 requests per 15 minutes
exports.authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Limit each IP to 15 requests per `window` (here, per 15 minutes)
    message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Requests that send a one-time code by email (resend verification, forgot password).
// Per-email cooldowns and hourly caps are enforced separately in utils/otp.js.
exports.otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Too many code requests from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Code submissions. Each code also allows only a few attempts (utils/otp.js).
exports.otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: 'Too many verification attempts from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Account creation: 20 new accounts per IP per hour. Only successful sign-ups count,
// so fixing a typo or a weak password doesn't use up the allowance, and a clinic
// where many patients register over the same Wi-Fi isn't locked out.
exports.accountCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    skipFailedRequests: true,
    message: { message: 'Too many accounts were created from this network. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});
