// utils/email.js  (or wherever this file is)

require('dotenv').config();  // if not already loading .env

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️ RESEND_API_KEY missing. Emails will not send.');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Helper to send email with Resend
const sendEmail = async ({ to, subject, html }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev', // Default Resend test domain
      // or verified domain: 'Abroad Vision Carrerz <no-reply@your-verified-domain.com>'
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Resend error:', error);
      throw error;
    }

    console.log('Email sent successfully:', data?.id);
    return true;
  } catch (err) {
    console.error('Email sending failed:', err);
    return false;
  }
};

// Send confirmation email to user
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

    const html = `
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
    `;

    return await sendEmail({
      to: userEmail,
      subject: 'Abroad Vision Carrerz - Registration Successful',
      html,
    });
  } catch (error) {
    console.error('Confirmation email error:', error);
    return false;
  }
};

// Send admin notification
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

    const html = `
      <h2>New User Registration</h2>
      ${rows.length ? rows.join('\n') : '<p>(No details provided)</p>'}
      <hr>
      <p>Please follow up with this student.</p>
    `;

    return await sendEmail({
      to: process.env.ADMIN_EMAILS?.split(',') || 'admin@yourdomain.com',
      subject: `New Registration: ${user?.fullName || user?.email || 'New Lead'}`,
      html,
    });
  } catch (error) {
    console.error('Admin email error:', error);
    return false;
  }
};

// Password reset code
const sendPasswordResetCodeEmail = async (userEmail, code) => {
  const html = `
    <h2>Password Reset</h2>
    <p>Use this code to reset your password:</p>
    <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; padding: 12px 16px; background: #f3f4f6; display: inline-block; border-radius: 10px;">${escapeHtml(code)}</div>
    <p style="margin-top: 16px; color: #555;">This code will expire in 10 minutes.</p>
    <p style="color: #777; font-size: 12px;">If you did not request a password reset, ignore this email.</p>
  `;

  return await sendEmail({
    to: userEmail,
    subject: 'Abroad Vision Carrerz - Password Reset Code',
    html,
  });
};

// Password changed confirmation
const sendPasswordChangedEmail = async (userEmail, userName) => {
  const safeName = escapeHtml(userName || '');

  const html = `
    <h2>Password Changed</h2>
    <p>Hi ${safeName || 'there'},</p>
    <p>Your account password was successfully changed.</p>
    <p style="margin-top: 12px; color: #555;">If you did not make this change, contact support immediately.</p>
    <hr>
    <p>Regards,<br><strong>Abroad Vision Carrerz Team</strong></p>
    <p style="color: #666; font-size: 12px;">Guiding Futures Beyond Borders</p>
  `;

  return await sendEmail({
    to: userEmail,
    subject: 'Abroad Vision Carrerz - Password Changed',
    html,
  });
};

module.exports = {
  sendConfirmationEmail,
  sendAdminEmail,
  sendPasswordResetCodeEmail,
  sendPasswordChangedEmail,
};
