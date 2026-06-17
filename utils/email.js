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
        const testAccount = await nodemailer.createTestAccount();
        host = 'smtp.ethereal.email';
        port = 587;
        authOptions = {
            user: testAccount.user,
            pass: testAccount.pass,
        };
        console.log('Created Ethereal Test Account:', authOptions.user);
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
    
    if (host === 'smtp.ethereal.email') {
        console.log('✉️ Test Email Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
};

module.exports = sendEmail;
