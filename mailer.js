const nodemailer = require('nodemailer');

// Create a reusable transporter using SMTP settings from environment variables
// Required env vars:
// - SMTP_HOST
// - SMTP_PORT (typically 587 for STARTTLS, 465 for SSL)
// - SMTP_SECURE ("true" for port 465 SSL, otherwise "false")
// - SMTP_USER
// - SMTP_PASS
// - SMTP_FROM (default sender address)

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail({ to, subject, text, html, from }) {
  if (!to) throw new Error('to is required');
  if (!subject) throw new Error('subject is required');
  const mailFrom = from || process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await transporter.sendMail({
    from: mailFrom,
    to,
    subject,
    text: text || undefined,
    html: html || undefined,
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  };
}

module.exports = { sendEmail };
