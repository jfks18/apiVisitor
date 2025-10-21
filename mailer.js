const nodemailer = require('nodemailer');

// Validate minimal SMTP config early so we don't silently fallback to localhost
const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const missing = requiredVars.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
if (missing.length > 0) {
  throw new Error(`SMTP configuration missing required env: ${missing.join(', ')}. Set them in .env or your hosting environment.`);
}

// Create a reusable transporter using SMTP settings from environment variables
// Optional env vars:
// - SMTP_PORT (typically 587 for STARTTLS, 465 for SSL)
// - SMTP_SECURE ("true" for port 465 SSL, otherwise "false")
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
// Optionally export a verify function for health checks
module.exports.verifySMTP = async function verifySMTP() {
  return transporter.verify();
};
