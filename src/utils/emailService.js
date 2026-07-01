const nodemailer = require('nodemailer');

let transporter = null;

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!mailer) {
    console.log(`[email:not-configured] To: ${to} | Subject: ${subject}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  await mailer.sendMail({ from, to, subject, html, text });
  return { sent: true };
}

async function sendBulkEmail(recipients, subject, html, text) {
  const results = [];
  for (const recipient of recipients) {
    try {
      const result = await sendEmail({ to: recipient, subject, html, text });
      results.push({ email: recipient, ...result });
    } catch (error) {
      results.push({ email: recipient, sent: false, reason: error.message });
    }
  }
  return results;
}

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendBulkEmail,
};
