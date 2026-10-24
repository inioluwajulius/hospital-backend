jest.mock('../models/OtpCode');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const OtpCode = require('../models/OtpCode');
const otp = require('../utils/otp');

const EMAIL = 'jane@example.com';
const select = (value) => ({ select: jest.fn().mockResolvedValue(value) });

// Capture the hash stored when a code is issued so verification can be exercised
const issueAndCapture = async () => {
    OtpCode.findOne = jest.fn().mockResolvedValue(null);
    let stored;
    OtpCode.create = jest.fn().mockImplementation(async (doc) => { stored = doc; return doc; });
    const result = await otp.issueCode(EMAIL, 'email_verification');
    return { result, stored };
};

describe('utils/otp', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('issueCode', () => {
        it('creates a 6-digit code and stores only its hash', async () => {
            const { result, stored } = await issueAndCapture();

            expect(result.issued).toBe(true);
            expect(result.code).toMatch(/^\d{6}$/);
            expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
            expect(JSON.stringify(stored)).not.toContain(result.code);
            expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
            expect(stored.attempts).toBe(0);
        });

        it('normalises the email', async () => {
            OtpCode.findOne = jest.fn().mockResolvedValue(null);
            OtpCode.create = jest.fn().mockResolvedValue({});
            await otp.issueCode('  Jane@Example.COM ', 'password_reset');
            expect(OtpCode.findOne).toHaveBeenCalledWith({ email: EMAIL, purpose: 'password_reset' });
        });

        it('enforces the resend cooldown', async () => {
            OtpCode.findOne = jest.fn().mockResolvedValue({ _id: 'x', lastSentAt: new Date(Date.now() - 10 * 1000), windowStartedAt: new Date(), sendCount: 1 });
            OtpCode.findOneAndUpdate = jest.fn();

            const result = await otp.issueCode(EMAIL, 'email_verification');

            expect(result).toEqual(expect.objectContaining({ issued: false, reason: 'cooldown' }));
            expect(result.retryAfterSeconds).toBeGreaterThan(40);
            expect(OtpCode.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('enforces the hourly send cap', async () => {
            OtpCode.findOne = jest.fn().mockResolvedValue({
                _id: 'x', lastSentAt: new Date(Date.now() - 5 * 60 * 1000), windowStartedAt: new Date(Date.now() - 20 * 60 * 1000), sendCount: otp.MAX_SENDS_PER_HOUR,
            });

            const result = await otp.issueCode(EMAIL, 'email_verification');

            expect(result).toEqual(expect.objectContaining({ issued: false, reason: 'limit' }));
        });

        it('replaces the previous code after the cooldown (old code invalidated)', async () => {
            const lastSentAt = new Date(Date.now() - 2 * 60 * 1000);
            OtpCode.findOne = jest.fn().mockResolvedValue({ _id: 'x', lastSentAt, windowStartedAt: lastSentAt, sendCount: 1 });
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue({});

            const result = await otp.issueCode(EMAIL, 'email_verification');

            expect(result.issued).toBe(true);
            const [filter, update] = OtpCode.findOneAndUpdate.mock.calls[0];
            expect(filter).toEqual({ _id: 'x', lastSentAt });
            expect(update.$set.attempts).toBe(0);
            expect(update.$set.sendCount).toBe(2);
        });

        it('rejects unknown purposes', async () => {
            await expect(otp.issueCode(EMAIL, 'password_reset_grant')).rejects.toThrow();
        });
    });

    describe('verifyCode', () => {
        it('accepts the right code once and consumes it atomically', async () => {
            const { result, stored } = await issueAndCapture();
            const record = { _id: 'r1', ...stored, attempts: 1 };
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue(record);
            OtpCode.findOneAndDelete = jest.fn().mockResolvedValue(record);

            await expect(otp.verifyCode(EMAIL, 'email_verification', result.code)).resolves.toEqual({ valid: true });
            expect(OtpCode.findOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ email: EMAIL, purpose: 'email_verification', attempts: { $lt: otp.MAX_ATTEMPTS } }),
                { $inc: { attempts: 1 } },
                { new: true }
            );
            expect(OtpCode.findOneAndDelete).toHaveBeenCalledWith({ _id: 'r1', codeHash: stored.codeHash });
        });

        it('rejects a reused code (already consumed by another request)', async () => {
            const { result, stored } = await issueAndCapture();
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 'r1', ...stored, attempts: 1 });
            OtpCode.findOneAndDelete = jest.fn().mockResolvedValue(null);

            await expect(otp.verifyCode(EMAIL, 'email_verification', result.code)).resolves.toEqual({ valid: false, reason: 'invalid' });
        });

        it('rejects a wrong code without consuming it', async () => {
            const { result, stored } = await issueAndCapture();
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 'r1', ...stored, attempts: 1 });
            OtpCode.findOneAndDelete = jest.fn();
            const wrong = result.code === '000000' ? '111111' : '000000';

            await expect(otp.verifyCode(EMAIL, 'email_verification', wrong)).resolves.toEqual({ valid: false, reason: 'invalid' });
            expect(OtpCode.findOneAndDelete).not.toHaveBeenCalled();
        });

        it('does not accept a code issued for a different purpose', async () => {
            const { result, stored } = await issueAndCapture(); // email_verification
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue({ _id: 'r1', ...stored, purpose: 'password_reset', attempts: 1 });
            OtpCode.findOneAndDelete = jest.fn();

            await expect(otp.verifyCode(EMAIL, 'password_reset', result.code)).resolves.toEqual({ valid: false, reason: 'invalid' });
        });

        it('reports expired codes', async () => {
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue(null);
            OtpCode.findOne = jest.fn().mockReturnValue(select({ expiresAt: new Date(Date.now() - 1000), attempts: 0 }));
            await expect(otp.verifyCode(EMAIL, 'email_verification', '123456')).resolves.toEqual({ valid: false, reason: 'expired' });
        });

        it('locks the code after too many attempts', async () => {
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue(null);
            OtpCode.findOne = jest.fn().mockReturnValue(select({ expiresAt: new Date(Date.now() + 60000), attempts: otp.MAX_ATTEMPTS }));
            await expect(otp.verifyCode(EMAIL, 'email_verification', '123456')).resolves.toEqual({ valid: false, reason: 'too_many_attempts' });
        });

        it('treats a missing code record as invalid', async () => {
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue(null);
            OtpCode.findOne = jest.fn().mockReturnValue(select(null));
            await expect(otp.verifyCode(EMAIL, 'email_verification', '123456')).resolves.toEqual({ valid: false, reason: 'invalid' });
        });

        it.each(['12345', '1234567', 'abcdef', '', null])('rejects malformed code %p without touching the database', async (code) => {
            OtpCode.findOneAndUpdate = jest.fn();
            await expect(otp.verifyCode(EMAIL, 'email_verification', code)).resolves.toEqual({ valid: false, reason: 'invalid' });
            expect(OtpCode.findOneAndUpdate).not.toHaveBeenCalled();
        });
    });

    describe('reset grants', () => {
        it('issues a random token and stores only its hash', async () => {
            OtpCode.findOneAndUpdate = jest.fn().mockResolvedValue({});
            const grant = await otp.createResetGrant(EMAIL);
            expect(grant.token).toMatch(/^[a-f0-9]{64}$/);
            const update = OtpCode.findOneAndUpdate.mock.calls[0][1].$set;
            expect(update.purpose).toBe('password_reset_grant');
            expect(update.codeHash).not.toBe(grant.token);
        });

        it('consumes a grant atomically and returns its email', async () => {
            OtpCode.findOneAndDelete = jest.fn().mockResolvedValue({ email: EMAIL });
            await expect(otp.consumeResetGrant('a'.repeat(64))).resolves.toBe(EMAIL);
            expect(OtpCode.findOneAndDelete).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'password_reset_grant', expiresAt: { $gt: expect.any(Date) } }));
        });

        it.each([undefined, '', 'not-hex', { $ne: null }])('rejects malformed token %p without querying', async (token) => {
            OtpCode.findOneAndDelete = jest.fn();
            await expect(otp.consumeResetGrant(token)).resolves.toBeNull();
            expect(OtpCode.findOneAndDelete).not.toHaveBeenCalled();
        });
    });
});
