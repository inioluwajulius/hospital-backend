const mongoose = require('mongoose');

/**
 * One-time codes and reset grants, bound to an email address and a purpose.
 * Only hashes are stored. At most one active record exists per (email, purpose):
 * issuing a new code replaces the previous one.
 */
const otpCodeSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    purpose: {
        type: String,
        enum: ['email_verification', 'password_reset', 'password_reset_grant'],
        required: true,
    },
    // HMAC of the code (or SHA-256 of a reset grant token); never the raw value
    codeHash: {
        type: String,
        required: true,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    attempts: {
        type: Number,
        default: 0,
    },
    // Resend cooldown and hourly send cap
    lastSentAt: Date,
    windowStartedAt: Date,
    sendCount: {
        type: Number,
        default: 0,
    },
}, { timestamps: true });

otpCodeSchema.index({ email: 1, purpose: 1 }, { unique: true });
otpCodeSchema.index({ purpose: 1, codeHash: 1 });
// Remove records an hour after they expire (kept briefly so resend limits still apply)
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 });

module.exports = mongoose.model('OtpCode', otpCodeSchema);
