const { verificationCodeEmail, passwordResetCodeEmail, passwordChangedEmail, escapeHtml } = require('../utils/emailTemplates');

describe('email templates', () => {
    it.each([
        ['verification', verificationCodeEmail, /Verify Your Email Address — MediCare/],
        ['password reset', passwordResetCodeEmail, /Your Password Reset Code — MediCare/],
    ])('%s email shows the code, expiry and a security notice in HTML and text', (_name, template, subject) => {
        const mail = template({ name: 'Jane Doe', code: '048213', expiresInMinutes: 10 });

        expect(mail.subject).toMatch(subject);
        for (const body of [mail.html, mail.text]) {
            expect(body).toContain('048213');
            expect(body).toContain('10 minutes');
            expect(body).toMatch(/ignore/i);
            expect(body).toContain('Jane');
        }
        expect(mail.html).toMatch(/^<!DOCTYPE html>/);
        expect(mail.html).toContain('role="presentation"');
    });

    it('password changed email never includes a password or code', () => {
        const mail = passwordChangedEmail({ name: 'Jane' });
        expect(mail.subject).toMatch(/Your Password Has Been Changed — MediCare/);
        expect(mail.html).toMatch(/Wasn.t you\?/);
        expect(mail.text).not.toMatch(/\d{6}/);
    });

    it('escapes user-controlled names', () => {
        const mail = verificationCodeEmail({ name: '<script>alert(1)</script>', code: '123456', expiresInMinutes: 10 });
        expect(mail.html).not.toContain('<script>');
        expect(mail.html).toContain('&lt;script&gt;');
        expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
    });
});
