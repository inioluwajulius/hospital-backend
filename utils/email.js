const nodemailer = require('nodemailer');

/**
 * Transactional email over SMTP (Brevo by default).
 *
 * Configuration (Brevo variables take precedence; the older EMAIL_* names still work):
 *   BREVO_SMTP_HOST / EMAIL_HOST          e.g. smtp-relay.brevo.com
 *   BREVO_SMTP_PORT / EMAIL_PORT          587 (STARTTLS) or 465 (SSL)
 *   BREVO_SMTP_USER / EMAIL_USERNAME      Brevo SMTP login
 *   BREVO_SMTP_PASSWORD / EMAIL_PASSWORD  Brevo SMTP key (not an API key)
 *   EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME   a sender verified in Brevo
 *   EMAIL_FROM                            legacy "Name <address>" form
 *
 * Message bodies are never logged: they can contain one-time codes and links.
 */

const getConfig = () => {
    const host = process.env.BREVO_SMTP_HOST || process.env.EMAIL_HOST;
    const port = Number(process.env.BREVO_SMTP_PORT || process.env.EMAIL_PORT || 587);
    const user = process.env.BREVO_SMTP_USER || process.env.EMAIL_USERNAME;
    const pass = process.env.BREVO_SMTP_PASSWORD || process.env.EMAIL_PASSWORD;
    return { host, port, user, pass };
};

const isEmailConfigured = () => Boolean(getConfig().host);

const getFromAddress = () => {
    const address = process.env.EMAIL_FROM_ADDRESS;
    if (address) {
        const name = (process.env.EMAIL_FROM_NAME || 'MediCare').replace(/["\r\n]/g, '');
        return `"${name}" <${address}>`;
    }
    return process.env.EMAIL_FROM || 'MediCare <noreply@medicare.com>';
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
        console.warn(`⚠️ Email is not configured (set BREVO_SMTP_HOST). Not sent to ${maskEmail(options.email)}: "${options.subject}"`);
        return { sent: false };
    }

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
            console.log(`✉️ Email sent to ${maskEmail(options.email)}: "${options.subject}"`);
            return { sent: true, messageId: info.messageId };
        } catch (error) {
            lastError = error;
            // Log only diagnostic fields; never credentials or message content
            console.error(`❌ Email to ${maskEmail(options.email)} via port ${port} failed: ${error.code || 'ERROR'} ${error.responseCode || ''} ${error.command || ''}`.trim());
            // Only connection problems are worth retrying on another port
            if (!isConnectionError(error)) break;
        }
    }

    const safeError = new Error('Email delivery failed');
    safeError.code = 'EMAIL_DELIVERY_FAILED';
    safeError.cause = lastError?.code;
    throw safeError;
};

module.exports = sendEmail;
module.exports.isEmailConfigured = isEmailConfigured;
