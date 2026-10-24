// Controller tests for the code-based verification and password reset endpoints.
jest.mock('../models/User');
jest.mock('../utils/email', () => {
    const send = jest.fn().mockResolvedValue({ sent: true });
    send.isEmailConfigured = jest.fn().mockReturnValue(true);
    return send;
});
jest.mock('../utils/otp', () => ({
    RESEND_COOLDOWN_SECONDS: 60,
    issueCode: jest.fn(),
    verifyCode: jest.fn(),
    createResetGrant: jest.fn(),
    consumeResetGrant: jest.fn(),
    clearCodes: jest.fn().mockResolvedValue({}),
}));
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const sendEmail = require('../utils/email');
const otp = require('../utils/otp');
const {
    login, verifyEmailCode, resendVerificationCode, verifyResetCode, resetPasswordWithCode, PASSWORD_REQUIREMENTS_MESSAGE,
} = require('../controllers/authController');

const createMockResponse = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};
const selectResolving = (value) => jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(value) });
const GRANT = 'b'.repeat(64);

describe('email verification and password reset endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        User.updateMany = jest.fn().mockResolvedValue({});
    });

    describe('login', () => {
        const mockLoginUser = (overrides) => {
            const user = { _id: 'u1', name: 'Jane', email: 'jane@example.com', role: 'patient', status: 'active', password: 'hash', ...overrides };
            User.find = jest.fn().mockReturnValue({ populate: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([user]) }) });
            bcrypt.compare.mockResolvedValue(true);
            jwt.sign.mockReturnValue('token');
        };

        it('blocks new accounts until the email is verified', async () => {
            mockLoginUser({ emailVerificationRequired: true, isEmailVerified: false });
            const res = createMockResponse();

            await login({ body: { email: 'jane@example.com', password: 'Strong#123' } }, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED', email: 'jane@example.com' }));
            expect(jwt.sign).not.toHaveBeenCalled();
        });

        it('does not reveal verification status when the password is wrong', async () => {
            mockLoginUser({ emailVerificationRequired: true, isEmailVerified: false });
            bcrypt.compare.mockResolvedValue(false);
            const res = createMockResponse();

            await login({ body: { email: 'jane@example.com', password: 'Wrong#123' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json.mock.calls[0][0].code).toBeUndefined();
        });

        it.each([
            ['existing account (no flag)', {}],
            ['verified account', { emailVerificationRequired: true, isEmailVerified: true }],
        ])('lets a %s log in', async (_name, overrides) => {
            mockLoginUser(overrides);
            const res = createMockResponse();

            await login({ body: { email: 'jane@example.com', password: 'Strong#123' } }, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'token' }));
        });
    });

    describe('verifyEmailCode', () => {
        it('marks every account on the email verified when the code is right', async () => {
            otp.verifyCode.mockResolvedValue({ valid: true });
            const res = createMockResponse();

            await verifyEmailCode({ body: { email: ' Jane@Example.com ', code: '123456' } }, res);

            expect(otp.verifyCode).toHaveBeenCalledWith('jane@example.com', 'email_verification', '123456');
            expect(User.updateMany).toHaveBeenCalledWith({ email: 'jane@example.com' }, expect.objectContaining({ $set: { isEmailVerified: true } }));
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it.each([
            ['invalid', 'INVALID'],
            ['expired', 'EXPIRED'],
            ['too_many_attempts', 'TOO_MANY_ATTEMPTS'],
        ])('reports %s codes without verifying', async (reason, code) => {
            otp.verifyCode.mockResolvedValue({ valid: false, reason });
            const res = createMockResponse();

            await verifyEmailCode({ body: { email: 'jane@example.com', code: '000000' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
            expect(User.updateMany).not.toHaveBeenCalled();
        });
    });

    describe('resendVerificationCode', () => {
        it('sends a branded code email to an unverified account', async () => {
            User.findOne = selectResolving({ name: 'Jane Doe', email: 'jane@example.com' });
            otp.issueCode.mockResolvedValue({ issued: true, code: '654321', expiresInMinutes: 10 });
            const res = createMockResponse();

            await resendVerificationCode({ body: { email: 'jane@example.com' } }, res);

            expect(User.findOne).toHaveBeenCalledWith({ email: 'jane@example.com', emailVerificationRequired: true, isEmailVerified: { $ne: true } });
            const mail = sendEmail.mock.calls[0][0];
            expect(mail.subject).toMatch(/Verify Your Email Address/);
            expect(mail.html).toContain('654321');
            expect(mail.message).toContain('654321');
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('responds identically for unknown or already-verified emails', async () => {
            User.findOne = selectResolving(null);
            const res = createMockResponse();

            await resendVerificationCode({ body: { email: 'nobody@example.com' } }, res);

            expect(otp.issueCode).not.toHaveBeenCalled();
            expect(sendEmail).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });

        it('does not send during the cooldown', async () => {
            User.findOne = selectResolving({ name: 'Jane', email: 'jane@example.com' });
            otp.issueCode.mockResolvedValue({ issued: false, reason: 'cooldown', retryAfterSeconds: 42 });
            const res = createMockResponse();

            await resendVerificationCode({ body: { email: 'jane@example.com' } }, res);

            expect(sendEmail).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });

    describe('verifyResetCode', () => {
        it('exchanges a valid code for a reset token', async () => {
            otp.verifyCode.mockResolvedValue({ valid: true });
            otp.createResetGrant.mockResolvedValue({ token: GRANT, expiresInMinutes: 15 });
            const res = createMockResponse();

            await verifyResetCode({ body: { email: 'jane@example.com', code: '123456' } }, res);

            expect(otp.verifyCode).toHaveBeenCalledWith('jane@example.com', 'password_reset', '123456');
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ resetToken: GRANT }));
        });

        it('uses one generic error for every failure reason', async () => {
            const messages = [];
            for (const reason of ['invalid', 'expired', 'too_many_attempts']) {
                otp.verifyCode.mockResolvedValue({ valid: false, reason });
                const res = createMockResponse();
                await verifyResetCode({ body: { email: 'jane@example.com', code: '000000' } }, res);
                expect(res.status).toHaveBeenCalledWith(400);
                messages.push(JSON.stringify(res.json.mock.calls[0][0]));
            }
            expect(new Set(messages).size).toBe(1);
            expect(otp.createResetGrant).not.toHaveBeenCalled();
        });
    });

    describe('resetPasswordWithCode', () => {
        it('rejects a weak password before using the reset token', async () => {
            const res = createMockResponse();
            await resetPasswordWithCode({ body: { resetToken: GRANT, password: 'weak' } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ message: PASSWORD_REQUIREMENTS_MESSAGE });
            expect(otp.consumeResetGrant).not.toHaveBeenCalled();
        });

        it('rejects mismatched confirmation', async () => {
            const res = createMockResponse();
            await resetPasswordWithCode({ body: { resetToken: GRANT, password: 'Strong#123', confirmPassword: 'Strong#124' } }, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(otp.consumeResetGrant).not.toHaveBeenCalled();
        });

        it('refuses to change the password without a valid reset token', async () => {
            otp.consumeResetGrant.mockResolvedValue(null);
            const res = createMockResponse();

            await resetPasswordWithCode({ body: { resetToken: 'forged', password: 'Strong#123' } }, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(User.updateMany).not.toHaveBeenCalled();
        });

        it('sets the new password, clears codes and sends a confirmation', async () => {
            otp.consumeResetGrant.mockResolvedValue('jane@example.com');
            User.find = selectResolving([{ name: 'Jane Doe' }]);
            bcrypt.hash.mockResolvedValue('new-hash');
            const res = createMockResponse();

            await resetPasswordWithCode({ body: { resetToken: GRANT, password: 'Strong#123', confirmPassword: 'Strong#123' } }, res);

            expect(User.updateMany).toHaveBeenCalledWith(
                { email: 'jane@example.com' },
                expect.objectContaining({ $set: { password: 'new-hash', isEmailVerified: true } })
            );
            expect(otp.clearCodes).toHaveBeenCalledWith('jane@example.com', ['password_reset', 'password_reset_grant']);
            const mail = sendEmail.mock.calls[0][0];
            expect(mail.subject).toMatch(/Password Has Been Changed/);
            expect(mail.html).not.toContain('Strong#123');
            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
