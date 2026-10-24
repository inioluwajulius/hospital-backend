// utils/email.js: Brevo HTTP API (used on hosts that block SMTP) with SMTP fallback
jest.mock('nodemailer', () => {
    const sendMail = jest.fn();
    return { createTransport: jest.fn(() => ({ sendMail })), __sendMail: sendMail };
});


const ENV_KEYS = ['BREVO_API_KEY', 'BREVO_SMTP_HOST', 'BREVO_SMTP_PORT', 'BREVO_SMTP_USER', 'BREVO_SMTP_PASSWORD', 'EMAIL_HOST', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'EMAIL_FROM'];
const saved = {};

// Fresh module instances per test (env is read at call time); returns the same nodemailer mock the module uses
let nodemailer;
const load = () => {
    jest.resetModules();
    nodemailer = require('nodemailer');
    return require('../utils/email');
};

describe('email delivery', () => {
    beforeEach(() => {
        ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
        process.env.EMAIL_FROM_ADDRESS = 'clinic@example.com';
        process.env.EMAIL_FROM_NAME = 'MediCare';
        global.fetch = jest.fn();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
        jest.restoreAllMocks();
    });

    it('is not configured without an API key or SMTP host', async () => {
        const sendEmail = load();
        expect(sendEmail.isEmailConfigured()).toBe(false);
        await expect(sendEmail({ email: 'a@b.com', subject: 'x', message: 'y' })).resolves.toEqual({ sent: false });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('sends through the Brevo HTTPS API when BREVO_API_KEY is set', async () => {
        process.env.BREVO_API_KEY = 'xkeysib-test';
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ messageId: '<abc@brevo>' }) });
        const sendEmail = load();

        const result = await sendEmail({ email: 'patient@example.com', subject: 'Your code', message: 'Code 123456', html: '<b>123456</b>' });

        expect(result).toEqual({ sent: true, messageId: '<abc@brevo>' });
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.brevo.com/v3/smtp/email');
        expect(init.headers['api-key']).toBe('xkeysib-test');
        expect(JSON.parse(init.body)).toEqual({
            sender: { name: 'MediCare', email: 'clinic@example.com' },
            to: [{ email: 'patient@example.com' }],
            subject: 'Your code',
            htmlContent: '<b>123456</b>',
            textContent: 'Code 123456',
        });
    });

    it('reports Brevo API rejections without leaking the key', async () => {
        process.env.BREVO_API_KEY = 'xkeysib-secret';
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 'unauthorized', message: 'Key not found' }) });
        const sendEmail = load();

        await expect(sendEmail({ email: 'a@b.com', subject: 'x', message: 'y' })).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED', cause: 'HTTP_401' });
        const logged = console.error.mock.calls.flat().join(' ');
        expect(logged).toMatch(/Key not found/);
        expect(logged).not.toMatch(/xkeysib-secret/);
    });

    it('falls back to SMTP when the API fails and SMTP is configured', async () => {
        process.env.BREVO_API_KEY = 'xkeysib-test';
        process.env.BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
        global.fetch.mockRejectedValue(Object.assign(new Error('network down'), { code: 'ECONNRESET' }));
        const sendEmail = load();
        nodemailer.__sendMail.mockResolvedValue({ messageId: 'smtp-1' });

        await expect(sendEmail({ email: 'a@b.com', subject: 'x', message: 'y' })).resolves.toEqual({ sent: true, messageId: 'smtp-1' });
    });

    it('uses SMTP alone when no API key is set (local development)', async () => {
        process.env.BREVO_SMTP_HOST = 'smtp-relay.brevo.com';
        const sendEmail = load();
        nodemailer.__sendMail.mockResolvedValue({ messageId: 'smtp-2' });

        await expect(sendEmail({ email: 'a@b.com', subject: 'x', message: 'y' })).resolves.toEqual({ sent: true, messageId: 'smtp-2' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('describes the active configuration without secrets', () => {
        process.env.BREVO_API_KEY = 'xkeysib-secret';
        const sendEmail = load();
        const summary = sendEmail.describeEmailConfig();
        expect(summary).toMatch(/Brevo HTTP API/);
        expect(summary).not.toMatch(/xkeysib/);
    });
});
