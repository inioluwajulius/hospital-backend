const crypto = require('crypto');
const OtpCode = require('../models/OtpCode');

/**
 * Email one-time codes (verification and password reset) and password reset grants.
 *
 * - 6-digit codes from crypto.randomInt, stored as HMAC-SHA256 keyed with a server
 *   secret, so a database leak doesn't expose guessable codes.
 * - Bound to (email, purpose); a new code replaces the previous one.
 * - Expire after CODE_TTL_MINUTES, allow MAX_ATTEMPTS guesses, single use.
 * - Resends are limited by a cooldown and an hourly cap.
 * - Consumption is atomic (findOneAndDelete on the matching hash), so a code
 *   can't be used twice even by concurrent requests.
 */

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const GRANT_TTL_MINUTES = 15;

const PURPOSES = ['email_verification', 'password_reset'];

const secret = () => {
    const key = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!key) throw new Error('OTP_SECRET or JWT_SECRET must be configured');
    return key;
};

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const hashCode = (email, purpose, code) =>
    crypto.createHmac('sha256', secret()).update(`${purpose}:${email}:${code}`).digest('hex');

const hashGrant = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const safeEqual = (a, b) => {
    const bufA = Buffer.from(String(a), 'hex');
    const bufB = Buffer.from(String(b), 'hex');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Create (or replace) the code for an email + purpose, respecting resend limits.
 * @returns {Promise<{issued: true, code: string, expiresInMinutes: number} | {issued: false, reason: 'cooldown'|'limit', retryAfterSeconds: number}>}
 */
const issueCode = async (rawEmail, purpose) => {
    if (!PURPOSES.includes(purpose)) throw new Error(`Unknown OTP purpose: ${purpose}`);
    const email = normalizeEmail(rawEmail);
    const now = new Date();
    const existing = await OtpCode.findOne({ email, purpose });

    let windowStartedAt = now;
    let sendCount = 1;
    if (existing) {
        const sinceLastSend = (now - (existing.lastSentAt || 0)) / 1000;
        if (sinceLastSend < RESEND_COOLDOWN_SECONDS) {
            return { issued: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLastSend) };
        }
        const windowAge = (now - (existing.windowStartedAt || 0)) / 1000;
        if (windowAge < 3600) {
            if (existing.sendCount >= MAX_SENDS_PER_HOUR) {
                return { issued: false, reason: 'limit', retryAfterSeconds: Math.ceil(3600 - windowAge) };
            }
            windowStartedAt = existing.windowStartedAt;
            sendCount = existing.sendCount + 1;
        }
    }

    const code = generateCode();
    const update = {
        email,
        purpose,
        codeHash: hashCode(email, purpose, code),
        expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000),
        attempts: 0,
        lastSentAt: now,
        windowStartedAt,
        sendCount,
    };

    try {
        if (existing) {
            // Optimistic concurrency: only replace the record we read, so two
            // simultaneous resends can't both bypass the cooldown
            const replaced = await OtpCode.findOneAndUpdate(
                { _id: existing._id, lastSentAt: existing.lastSentAt },
                { $set: update },
                { new: true }
            );
            if (!replaced) return { issued: false, reason: 'cooldown', retryAfterSeconds: RESEND_COOLDOWN_SECONDS };
        } else {
            await OtpCode.create(update);
        }
    } catch (error) {
        if (error.code === 11000) {
            return { issued: false, reason: 'cooldown', retryAfterSeconds: RESEND_COOLDOWN_SECONDS };
        }
        throw error;
    }

    return { issued: true, code, expiresInMinutes: CODE_TTL_MINUTES };
};

/**
 * Check and consume a code.
 * @returns {Promise<{valid: true} | {valid: false, reason: 'invalid'|'expired'|'too_many_attempts'}>}
 */
const verifyCode = async (rawEmail, purpose, rawCode) => {
    const email = normalizeEmail(rawEmail);
    const code = String(rawCode ?? '').trim();
    if (!email || !/^\d{6}$/.test(code) || !PURPOSES.includes(purpose)) {
        return { valid: false, reason: 'invalid' };
    }

    // Count the attempt atomically before comparing, so parallel guesses all count
    const record = await OtpCode.findOneAndUpdate(
        { email, purpose, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
        { $inc: { attempts: 1 } },
        { new: true }
    );

    if (!record) {
        const stale = await OtpCode.findOne({ email, purpose }).select('expiresAt attempts');
        if (!stale) return { valid: false, reason: 'invalid' };
        if (stale.expiresAt <= new Date()) return { valid: false, reason: 'expired' };
        return { valid: false, reason: 'too_many_attempts' };
    }

    if (!safeEqual(record.codeHash, hashCode(email, purpose, code))) {
        return { valid: false, reason: record.attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid' };
    }

    // Single use: only one request can delete the matching record
    const consumed = await OtpCode.findOneAndDelete({ _id: record._id, codeHash: record.codeHash });
    return consumed ? { valid: true } : { valid: false, reason: 'invalid' };
};

/** Short-lived, single-use authorisation to set a new password, issued after a valid reset code. */
const createResetGrant = async (rawEmail) => {
    const email = normalizeEmail(rawEmail);
    const token = crypto.randomBytes(32).toString('hex');
    await OtpCode.findOneAndUpdate(
        { email, purpose: 'password_reset_grant' },
        { $set: { email, purpose: 'password_reset_grant', codeHash: hashGrant(token), expiresAt: new Date(Date.now() + GRANT_TTL_MINUTES * 60 * 1000), attempts: 0 } },
        { upsert: true, new: true }
    );
    return { token, expiresInMinutes: GRANT_TTL_MINUTES };
};

/** Atomically consume a reset grant. @returns {Promise<string|null>} the email it was issued for */
const consumeResetGrant = async (token) => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const grant = await OtpCode.findOneAndDelete({
        purpose: 'password_reset_grant',
        codeHash: hashGrant(token),
        expiresAt: { $gt: new Date() },
    });
    return grant ? grant.email : null;
};

/** Remove every outstanding code/grant of a purpose for an email (e.g. after a successful reset). */
const clearCodes = (rawEmail, purposes) =>
    OtpCode.deleteMany({ email: normalizeEmail(rawEmail), purpose: { $in: purposes } });

module.exports = {
    CODE_TTL_MINUTES,
    MAX_ATTEMPTS,
    RESEND_COOLDOWN_SECONDS,
    MAX_SENDS_PER_HOUR,
    GRANT_TTL_MINUTES,
    issueCode,
    verifyCode,
    createResetGrant,
    consumeResetGrant,
    clearCodes,
};
