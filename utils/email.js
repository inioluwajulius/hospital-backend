const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    // Using Ethereal Email for testing if no environment variables are provided
    let authOptions = {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
    };

    let host = process.env.EMAIL_HOST;
    let port = process.env.EMAIL_PORT;

    if (!host) {
        console.warn('⚠️ No EMAIL_HOST configured in environment variables. Email will NOT be sent.');
        return;
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        auth: authOptions,
    });

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'MediCare System <noreply@medicare.com>',
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✉️ Email sent successfully');
};

module.exports = sendEmail;
