const nodemailer = require('nodemailer');
const path = require('path');

const { loadEnv } = require('../utils/loadEnv');

// Always load backend/.env (works even when started from workspace root)
loadEnv(path.join(__dirname, '..', '.env'), { override: true });

function normalizeEmailUser(value) {
  return String(value || '').trim();
}

// Google App Passwords are often shown as 4 groups of 4 characters separated by spaces.
// In .env, those spaces become part of the value and will break auth, so we normalize.
function normalizeEmailPassword(value) {
  const trimmed = String(value || '').trim();
  if (/^[a-z0-9]{4}(?:\s+[a-z0-9]{4}){3}$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, '');
  }
  return trimmed;
}
const EMAIL_USER = normalizeEmailUser(process.env.BREVO_SMTP_USER || process.env.EMAIL_USER);
const EMAIL_PASSWORD = normalizeEmailPassword(process.env.BREVO_SMTP_PASS || process.env.EMAIL_PASSWORD);

if (!EMAIL_USER || !EMAIL_PASSWORD) {
  console.warn('⚠️ Email ENV variables missing (BREVO_SMTP_USER / BREVO_SMTP_PASS). Password reset emails will not send.');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Brevo SMTP transporter (replaces Gmail)
const transporter = nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.BREVO_SMTP_PORT) || 587,
  secure: false,  // false for 587 (STARTTLS), true only if you switch to 465
  auth: {
    user: EMAIL_USER,
    pass: process.env.BREVO_SMTP_PASS
  },
  // Optional: for debugging
  logger: true,
  debug: true
});

// Send confirmation email to user
// Supports an optional custom message and extra context (e.g. preferred destination).
const sendConfirmationEmail = async (userEmail, userName, customMessage, extra = {}) => {
  try {
    const safeName = escapeHtml(userName || '');
    const safeMessage = customMessage ? escapeHtml(customMessage) : '';
    const safePreferredCountry = extra?.preferredCountry ? escapeHtml(extra.preferredCountry) : '';
    const safeDesiredCourse = extra?.desiredCourse ? escapeHtml(extra.desiredCourse) : '';

    const introLine = safeMessage
      ? `<p>${safeMessage}</p>`
      : `<p>Your registration has been successfully completed!</p>`;

    const destinationBlock = safePreferredCountry
      ? `<p><strong>Dream destination:</strong> ${safePreferredCountry}</p>`
      : '';

    const courseBlock = safeDesiredCourse
      ? `<p><strong>Desired course:</strong> ${safeDesiredCourse}</p>`
      : '';

    const mailOptions = {
      from: EMAIL_USER,
      to: userEmail,
      subject: 'Abroad Vision Carrerz - Registration Successful',
      html: `
        <h2>Welcome ${safeName}! ✨</h2>
        <p>Thank you for registering with <strong>Abroad Vision Carrerz</strong>.</p>
        ${introLine}
        ${destinationBlock}
        ${courseBlock}
        <p>Our team will review your details and get back to you shortly.</p>
        <hr>
        <p><strong>Next Steps:</strong></p>
        <ul>
          <li>Our counselors will contact you on WhatsApp</li>
          <li>Schedule your free consultation</li>
          <li>Get personalized guidance for your study abroad journey</li>
        </ul>
        <p>Best regards,<br><strong>Abroad Vision Carrerz Team</strong></p>
        <p style="color: #666; font-size: 12px;">Guiding Futures Beyond Borders</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Confirmation email sent to:', userEmail);
  } catch (error) {
    console.error('Email error:', error);
  }
};

// Send admin notification email
const sendAdminEmail = async (user) => {
  try {
    const rows = [];
    const addRow = (label, value) => {
      const v = String(value ?? '').trim();
      if (!v) return;
      rows.push(`<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(v)}</p>`);
    };

    addRow('Name', user?.fullName);
    addRow('Email', user?.email);
    addRow('Phone', user?.phone);
    addRow('Country', user?.country);
    addRow('Preferred Country', user?.preferredCountry);
    addRow('Desired Course', user?.desiredCourse);
    addRow('Level Of Study', user?.levelOfStudy);
    addRow('City', user?.city);

    const mailOptions = {
      from: EMAIL_USER,
      to: process.env.ADMIN_EMAILS,
      subject: `New Registration: ${user?.fullName || user?.email || 'New Lead'}`,
      html: `
        <h2>New User Registration</h2>
        ${rows.join('\n') || '<p>(No details provided)</p>'}
        <hr>
        <p>Please follow up with this student.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent');
  } catch (error) {
    console.error('Email error:', error);
  }
};

// Send password reset code email
// NOTE: We never email or store plaintext passwords. Only a short-lived code.
const sendPasswordResetCodeEmail = async (userEmail, code) => {
  try {
    const mailOptions = {
      from: EMAIL_USER,
      to: userEmail,
      subject: 'Abroad Vision Carrerz - Password Reset Code',
      html: `
        <h2>Password Reset</h2>
        <p>Use this code to reset your password:</p>
        <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; padding: 12px 16px; background: #f3f4f6; display: inline-block; border-radius: 10px;">${code}</div>
        <p style="margin-top: 16px; color: #555;">This code will expire in 10 minutes.</p>
        <p style="color: #777; font-size: 12px;">If you did not request a password reset, you can ignore this email.</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Password reset code sent to:', userEmail);
    return true;
  } catch (error) {
    console.error('Password reset email error:', error);
    return false;
  }
};

// Send password changed confirmation email
const sendPasswordChangedEmail = async (userEmail, userName) => {
  try {
    const safeName = escapeHtml(userName || '');

    const mailOptions = {
      from: EMAIL_USER,
      to: userEmail,
      subject: 'Abroad Vision Carrerz - Password Changed',
      html: `
        <h2>Password Changed</h2>
        <p>Hi ${safeName || 'there'},</p>
        <p>Your account password was successfully changed.</p>
        <p style="margin-top: 12px; color: #555;">If you did not make this change, please contact our support team immediately.</p>
        <hr>
        <p>Regards,<br><strong>Abroad Vision Carrerz Team</strong></p>
        <p style="color: #666; font-size: 12px;">Guiding Futures Beyond Borders</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Password changed email sent to:', userEmail);
    return true;
  } catch (error) {
    console.error('Password changed email error:', error);
    return false;
  }
};

module.exports = {
  sendConfirmationEmail,
  sendAdminEmail,
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail
};
