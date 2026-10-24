/**
 * Branded transactional email templates (HTML + plain-text fallback).
 *
 * Table layout and inline styles for Gmail/Outlook compatibility. Colours follow the
 * web app: emerald primary (#10B981), blue-to-emerald gradient header, slate text.
 * Every dynamic value is HTML-escaped.
 */

const APP_NAME = 'MediCare';
const BRAND = {
    primary: '#10B981',
    primaryDark: '#059669',
    blue: '#2563EB',
    text: '#0F172A',
    body: '#334155',
    muted: '#64748B',
    border: '#E2E8F0',
    background: '#F1F5F9',
    codeBackground: '#ECFDF5',
};
const FONT = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

const supportLine = () => {
    const url = process.env.FRONTEND_URL;
    return url ? `<a href="${escapeHtml(url)}" style="color:${BRAND.primaryDark};text-decoration:none;">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a>` : APP_NAME;
};

/** Shared layout: header with logo mark, content card, footer. */
const layout = ({ preheader, heading, bodyHtml }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.background};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${BRAND.background};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
        <!-- Header -->
        <tr>
          <td style="background-color:${BRAND.primaryDark};background-image:linear-gradient(135deg, ${BRAND.blue} 0%, ${BRAND.primaryDark} 100%);border-radius:16px 16px 0 0;padding:28px 32px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="40" height="40" align="center" valign="middle" style="background-color:#FFFFFF;border-radius:10px;font-family:${FONT};font-size:26px;font-weight:800;line-height:40px;color:${BRAND.primaryDark};">+</td>
                <td style="padding-left:12px;font-family:${FONT};">
                  <div style="font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;">${APP_NAME}</div>
                  <div style="font-size:12px;color:#D1FAE5;">Hospital Management System</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Card -->
        <tr>
          <td style="background-color:#FFFFFF;border:1px solid ${BRAND.border};border-top:0;border-radius:0 0 16px 16px;padding:36px 32px;font-family:${FONT};">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:800;color:${BRAND.text};">${escapeHtml(heading)}</h1>
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding:24px 16px;font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.muted};">
            This is an automated security message from ${APP_NAME}. Please don't reply to this email.<br>
            ${supportLine()}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const paragraph = (html) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${BRAND.body};">${html}</p>`;

const codeBlock = (code) => `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;">
  <tr>
    <td align="center" style="background-color:${BRAND.codeBackground};border:1px solid #A7F3D0;border-radius:12px;padding:20px 12px;">
      <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND.text};padding-left:10px;">${escapeHtml(code)}</div>
    </td>
  </tr>
</table>`;

const notice = (html) => `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:8px;">
  <tr>
    <td style="background-color:${BRAND.background};border-radius:10px;padding:14px 16px;font-size:13px;line-height:20px;color:${BRAND.muted};">${html}</td>
  </tr>
</table>`;

/** A. Account verification code */
const verificationCodeEmail = ({ name, code, expiresInMinutes }) => {
    const subject = `Verify Your Email Address — ${APP_NAME}`;
    const html = layout({
        preheader: `Your ${APP_NAME} verification code is ${code}`,
        heading: 'Verify your email address',
        bodyHtml:
            paragraph(`Hi ${escapeHtml(firstName(name))},`) +
            paragraph(`Thanks for joining ${APP_NAME}. Enter this code to confirm your email address and activate your account:`) +
            codeBlock(code) +
            paragraph(`The code expires in <strong>${escapeHtml(expiresInMinutes)} minutes</strong> and can only be used once.`) +
            notice(`<strong style="color:${BRAND.body};">Didn't create an account?</strong> You can safely ignore this email. Never share this code with anyone; ${APP_NAME} staff will never ask for it.`),
    });
    const text = [
        `Hi ${firstName(name)},`,
        '',
        `Thanks for joining ${APP_NAME}. Your email verification code is:`,
        '',
        `    ${code}`,
        '',
        `It expires in ${expiresInMinutes} minutes and can only be used once.`,
        '',
        `Didn't create an account? Ignore this email. Never share this code with anyone.`,
        '',
        `— ${APP_NAME}`,
    ].join('\n');
    return { subject, html, text };
};

/** B. Password reset code */
const passwordResetCodeEmail = ({ name, code, expiresInMinutes, initiatedByAdmin = false }) => {
    const intro = initiatedByAdmin
        ? 'An administrator at your hospital started a password reset for your account. Open "Forgot your password?" on the login page, enter your email, then this code:'
        : 'We received a request to reset the password for your account. Enter this code to continue:';
    const subject = `Your Password Reset Code — ${APP_NAME}`;
    const html = layout({
        preheader: `Your ${APP_NAME} password reset code is ${code}`,
        heading: 'Reset your password',
        bodyHtml:
            paragraph(`Hi ${escapeHtml(firstName(name))},`) +
            paragraph(escapeHtml(intro).replace(/&quot;/g, '"')) +
            codeBlock(code) +
            paragraph(`The code expires in <strong>${escapeHtml(expiresInMinutes)} minutes</strong> and can only be used once.`) +
            notice(`<strong style="color:${BRAND.body};">Didn't request this?</strong> Ignore this email and your password will stay the same. Never share this code with anyone.`),
    });
    const text = [
        `Hi ${firstName(name)},`,
        '',
        intro,
        '',
        `    ${code}`,
        '',
        `It expires in ${expiresInMinutes} minutes and can only be used once.`,
        '',
        "Didn't request this? Ignore this email and your password will stay the same.",
        '',
        `— ${APP_NAME}`,
    ].join('\n');
    return { subject, html, text };
};

/** C. Password changed confirmation */
const passwordChangedEmail = ({ name, changedAt = new Date() }) => {
    const subject = `Your Password Has Been Changed — ${APP_NAME}`;
    const when = changedAt.toUTCString();
    const html = layout({
        preheader: `The password for your ${APP_NAME} account was changed`,
        heading: 'Your password was changed',
        bodyHtml:
            paragraph(`Hi ${escapeHtml(firstName(name))},`) +
            paragraph(`The password for your ${APP_NAME} account was changed on <strong>${escapeHtml(when)}</strong>. You can now log in with your new password.`) +
            notice(`<strong style="color:#B91C1C;">Wasn't you?</strong> Reset your password immediately using "Forgot your password?" on the login page, and contact your hospital administrator.`),
    });
    const text = [
        `Hi ${firstName(name)},`,
        '',
        `The password for your ${APP_NAME} account was changed on ${when}.`,
        '',
        "Wasn't you? Reset your password immediately using \"Forgot your password?\" on the login page, and contact your hospital administrator.",
        '',
        `— ${APP_NAME}`,
    ].join('\n');
    return { subject, html, text };
};

/** Outcome of a doctor/nurse application to join a hospital */
const applicationDecisionEmail = ({ name, hospitalName, approved, reason, loginUrl }) => {
    const hospital = hospitalName || 'the hospital';
    const subject = approved
        ? `Your ${hospital} account has been approved — ${APP_NAME}`
        : `Update on your application to ${hospital} — ${APP_NAME}`;
    const html = layout({
        preheader: approved ? 'Your account is now active' : 'Your application was not approved',
        heading: approved ? 'Your account is approved' : 'Your application was not approved',
        bodyHtml:
            paragraph(`Hi ${escapeHtml(firstName(name))},`) +
            (approved
                ? paragraph(`An administrator at <strong>${escapeHtml(hospital)}</strong> approved your account. You can now log in${loginUrl ? ` at <a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a>` : ''}.`)
                : paragraph(`An administrator at <strong>${escapeHtml(hospital)}</strong> reviewed your application and did not approve it.`) +
                  (reason ? notice(`<strong>Reason:</strong> ${escapeHtml(reason)}`) : '') +
                  paragraph('If you think this is a mistake, please contact the hospital administration.')),
    });
    const text = [
        `Hi ${firstName(name)},`,
        '',
        approved
            ? `An administrator at ${hospital} approved your account. You can now log in${loginUrl ? ` at ${loginUrl}` : ''}.`
            : `An administrator at ${hospital} reviewed your application and did not approve it.${reason ? `\n\nReason: ${reason}` : ''}\n\nIf you think this is a mistake, please contact the hospital administration.`,
        '',
        `— ${APP_NAME}`,
    ].join('\n');
    return { subject, html, text };
};

module.exports = {
    escapeHtml,
    applicationDecisionEmail,
    verificationCodeEmail,
    passwordResetCodeEmail,
    passwordChangedEmail,
};
