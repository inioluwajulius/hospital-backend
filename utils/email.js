const nodemailer = require('nodemailer');

/**
 * Transactional email via Brevo.
 *
 * Preferred: Brevo's HTTP API (HTTPS, port 443). Use this on hosts that block
 * outbound SMTP, e.g. Render's free tier blocks ports 25, 465 and 587.
 *   BREVO_API_KEY                         Brevo API key (SMTP & API > API Keys)
 *
 * Fallback: SMTP (Brevo variables take precedence; the older EMAIL_* names still work):
 *   BREVO_SMTP_HOST / EMAIL_HOST          e.g. smtp-relay.brevo.com
 *   BREVO_SMTP_PORT / EMAIL_PORT          587 (STARTTLS), 2525 or 465 (SSL)
 *   BREVO_SMTP_USER / EMAIL_USERNAME      Brevo SMTP login
 *   BREVO_SMTP_PASSWORD / EMAIL_PASSWORD  Brevo SMTP key (not an API key)
 *
 * Sender (both): EMAIL_FROM_ADDRESS + EMAIL_FROM_NAME (a sender verified in Brevo),
 * or the legacy EMAIL_FROM "Name <address>" form.
 *
 * Message bodies are never logged: they can contain one-time codes and links.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_TIMEOUT_MS = 15000;

const getConfig = () => {
    const host = process.env.BREVO_SMTP_HOST || process.env.EMAIL_HOST;
    const port = Number(process.env.BREVO_SMTP_PORT || process.env.EMAIL_PORT || 587);
    const user = process.env.BREVO_SMTP_USER || process.env.EMAIL_USERNAME;
    const pass = process.env.BREVO_SMTP_PASSWORD || process.env.EMAIL_PASSWORD;
    return { host, port, user, pass };
};

const apiKey = () => (process.env.BREVO_API_KEY || '').trim();

const isEmailConfigured = () => Boolean(apiKey() || getConfig().host);

/** Sender as { name, email } */
const getSender = () => {
    const address = (process.env.EMAIL_FROM_ADDRESS || '').trim();
    const name = (process.env.EMAIL_FROM_NAME || 'MediCare').replace(/["\r\n]/g, '');
    if (address) return { name, email: address };
    const legacy = (process.env.EMAIL_FROM || '').match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
    if (legacy) return { name: legacy[1].trim() || name, email: legacy[2].trim() };
    return { name, email: (process.env.EMAIL_FROM || 'noreply@medicare.com').trim() };
};

const getFromAddress = () => {
    const { name, email } = getSender();
    return `"${name}" <${email}>`;
};

// Brevo accepts 587 and 2525 (STARTTLS) and 465 (TLS). Some networks block a port,
// so on a connection failure the other ports are tried and the working one is kept.
const BREVO_PORTS = [587, 2525, 465];
const CONNECTION_ERRORS = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNECTION'];
const isConnectionError = (error) => CONNECTION_ERRORS.includes(error.code) || error.command === 'CONN';

// One pooled transporter per host/port/user, reused across sends
const transports = new Map();
let workingPort = null;

const getTransport = (port) => {
    const { host, user, pass } = getConfig();
    const key = `${host}:${port}:${user}`;
    if (!transports.has(key)) {
        transports.set(key, nodemailer.createTransport({
            host,
            port,
            secure: port === 465, // 465 = implicit TLS; 587/2525 upgrade with STARTTLS
            requireTLS: port !== 465 && process.env.NODE_ENV === 'production',
            auth: user ? { user, pass } : undefined,
            pool: true,
            maxConnections: 3,
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 20000,
        }));
    }
    return transports.get(key);
};

// Configured port first, then (for Brevo) the alternatives
const portsToTry = () => {
    const { host, port } = getConfig();
    const ports = [workingPort, port];
    if (/brevo\.com$/i.test(host || '')) ports.push(...BREVO_PORTS);
    return [...new Set(ports.filter(Boolean))];
};

const maskEmail = (email) => String(email || '').replace(/^(.).*(@.*)$/, '$1***$2');

/** Send through Brevo's HTTPS API */
const sendViaApi = async (options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        const response = await fetch(BREVO_API_URL, {
            method: 'POST',
            headers: { 'api-key': apiKey(), 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
                sender: getSender(),
                to: [{ email: options.email }],
                subject: options.subject,
                ...(options.html ? { htmlContent: options.html } : {}),
                ...(options.message ? { textContent: options.message } : {}),
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            // Brevo's error message (e.g. "Key not found", "sender not valid") is safe to log
            const body = await response.json().catch(() => ({}));
            throw Object.assign(new Error('Brevo API rejected the email'), { code: `HTTP_${response.status}`, detail: body.message || body.code || '' });
        }
        const data = await response.json().catch(() => ({}));
        return { sent: true, messageId: data.messageId };
    } catch (error) {
        if (error.name === 'AbortError') throw Object.assign(new Error('Brevo API timed out'), { code: 'API_TIMEOUT' });
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

/** Send over SMTP, trying Brevo's alternative ports on connection failures */
const sendViaSmtp = async (options) => {
    const mail = {
        from: getFromAddress(),
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html,
    };

    let lastError;
    for (const port of portsToTry()) {
        try {
            const info = await getTransport(port).sendMail(mail);
            if (workingPort !== port && workingPort !== null) {
                console.warn(`⚠️ SMTP port ${workingPort} stopped working; now using ${port}`);
            } else if (port !== getConfig().port) {
                console.warn(`⚠️ SMTP port ${getConfig().port} is unreachable from this network; using ${port}. Set BREVO_SMTP_PORT=${port} to skip the retry.`);
            }
            workingPort = port;
            return { sent: true, messageId: info.messageId };
        } catch (error) {
            lastError = error;
            // Log only diagnostic fields; never credentials or message content
            console.error(`❌ SMTP to ${maskEmail(options.email)} via port ${port} failed: ${error.code || 'ERROR'} ${error.responseCode || ''} ${error.command || ''}`.trim());
            // Only connection problems are worth retrying on another port
            if (!isConnectionError(error)) break;
        }
    }
    throw lastError || new Error('SMTP delivery failed');
};

/**
 * Send an email.
 * @param {object} options
 * @param {string} options.email    recipient
 * @param {string} options.subject
 * @param {string} [options.message] plain-text body
 * @param {string} [options.html]    HTML body
 * @returns {Promise<{sent: boolean, messageId?: string}>}
 * @throws {Error} with a safe message when delivery fails
 */
const sendEmail = async (options) => {
    if (!isEmailConfigured()) {
        console.warn(`⚠️ Email is not configured (set BREVO_API_KEY or BREVO_SMTP_HOST). Not sent to ${maskEmail(options.email)}: "${options.subject}"`);
        return { sent: false };
    }

    let lastError;
    if (apiKey()) {
        try {
            const result = await sendViaApi(options);
            console.log(`✉️ Email sent via Brevo API to ${maskEmail(options.email)}: "${options.subject}"`);
            return result;
        } catch (error) {
            lastError = error;
            console.error(`❌ Brevo API email to ${maskEmail(options.email)} failed: ${error.code || 'ERROR'} ${error.detail || error.message}`.trim());
        }
    }

    if (getConfig().host) {
        try {
            const result = await sendViaSmtp(options);
            console.log(`✉️ Email sent via SMTP to ${maskEmail(options.email)}: "${options.subject}"`);
            return result;
        } catch (error) {
            lastError = error;
        }
    }

    const safeError = new Error('Email delivery failed');
    safeError.code = 'EMAIL_DELIVERY_FAILED';
    safeError.cause = lastError?.code;
    throw safeError;
};

/** One-line summary for startup logs (no secrets) */
const describeEmailConfig = () => {
    const { host, port } = getConfig();
    const sender = getSender().email;
    if (apiKey()) return `Email: Brevo HTTP API${host ? ` (SMTP ${host}:${port} as fallback)` : ''}, sender ${sender}`;
    if (host) return `Email: SMTP ${host}:${port}, sender ${sender}. If your host blocks SMTP (e.g. Render free tier), set BREVO_API_KEY.`;
    return 'Email: NOT configured. Set BREVO_API_KEY (or BREVO_SMTP_*) to send verification and reset codes.';
};

module.exports = sendEmail;
module.exports.isEmailConfigured = isEmailConfigured;
module.exports.describeEmailConfig = describeEmailConfig;
