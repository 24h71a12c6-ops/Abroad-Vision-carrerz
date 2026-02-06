const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const { exec } = require('child_process');

const { loadEnv } = require('./utils/loadEnv');

// Always load backend/.env (works even when started from workspace root)
// Use override:true so stale machine-level env vars don't win.
loadEnv(path.join(__dirname, '.env'), { override: true });

process.on('unhandledRejection', (reason) => {
  console.error('✗ Unhandled promise rejection:', reason?.response?.data || reason?.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('✗ Uncaught exception:', err?.stack || err?.message || err);
  process.exit(1);
});

const { sendConfirmationEmail, sendAdminEmail, sendPasswordResetCodeEmail, sendPasswordChangedEmail } = require('./services/emailService');
const { sendAdminWhatsApp, sendAdminWhatsAppTemplate, getWhatsAppSenderInfo } = require('./services/whatsappService');
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;
const upload = multer({ storage: multer.memoryStorage() });

const findListeningPid = (port) =>
  new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);

    exec(`netstat -ano | findstr :${port}`, { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null);

      const lines = String(stdout)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        // Example: TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    1234
        if (!/LISTENING\s+\d+$/i.test(line)) continue;
        const match = line.match(/(\d+)$/);
        if (match?.[1]) return resolve(match[1]);
      }

      resolve(null);
    });
  });

const fireAndForget = (fn, label) => {
  try {
    const result = fn();
    Promise.resolve(result).catch((err) => {
      console.error(label || 'Background task failed:', err?.response?.data || err?.message || err);
    });
  } catch (err) {
    console.error(label || 'Background task failed:', err?.response?.data || err?.message || err);
  }
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post(
  '/api/abroad-registration',
  upload.fields([
    { name: 'resume' },
    { name: 'transcripts' },
    { name: 'passportCopy' },
    { name: 'testScoreCard' }
  ]),
  async (req, res) => {
    try {
      const data = req.body;
      const files = req.files || {};

      await pool.query(
        `INSERT INTO next_form (
              fullName, dob, gender, nationality, phone, email, city, passportStatus, passport_id,
              highestQualification, currentCourse, specialization, collegeName, yearOfPassing, cgpa, backlogs,
              preferredCountry, levelOfStudy, coaching, preferredIntake, desiredCourse, budgetRange, workExperience, companyName, role, duration,
              fundingSource, familyIncome, loanStatus, resume, transcripts, passportCopy, testScoreCard, declaration
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.fullName,
          data.dob,
          data.gender,
          data.nationality,
          data.phone,
          data.email,
          data.city,
          data.passportStatus,
          data.passport_id,
          data.highestQualification,
          data.currentCourse,
          data.specialization,
          data.collegeName,
          data.yearOfPassing,
          data.cgpa,
          data.backlogs,
          data.preferredCountry,
          data.levelOfStudy,
          data.coaching || 'None',
          data.preferredIntake,
          data.desiredCourse,
          data.budgetRange,
          data.workExperience,
          data.companyName,
          data.role,
          data.duration,
          data.fundingSource,
          data.familyIncome,
          data.loanStatus,
          files.resume?.[0]?.buffer || null,
          files.transcripts?.[0]?.buffer || null,
          files.passportCopy?.[0]?.buffer || null,
          files.testScoreCard?.[0]?.buffer || null,
          data.declaration ? 1 : 0
        ]
      );

      const safe = (v) => String(v ?? '').trim();
      const line = (label, value) => {
        const v = safe(value);
        return v ? `${label}: ${v}` : null;
      };

      const adminLines = [
        'New Abroad Registration ✅',
        line('Name', data.fullName),
        line('Email', data.email),
        line('Phone', data.phone),
        line('City', data.city),
        line('Nationality', data.nationality),
        line('Preferred Country', data.preferredCountry),
        line('Level Of Study', data.levelOfStudy),
        line('Desired Course', data.desiredCourse),
        line('Preferred Intake', data.preferredIntake),
        line('Budget Range', data.budgetRange),
        line('Passport Status', data.passportStatus),
        line('Highest Qualification', data.highestQualification),
        line('Work Experience', data.workExperience),
      ].filter(Boolean);

      const adminMsg = adminLines.join('\n');

      const preferredCountry = safe(data.preferredCountry);
      const desiredCourse = safe(data.desiredCourse);
      const userMsg = preferredCountry
        ? `You are successfully registered for your dream study destination: ${preferredCountry}. Our team will contact you shortly.`
        : `You are successfully registered for your dream study destination. Our team will contact you shortly.`;

      if (sendAdminWhatsApp) fireAndForget(() => sendAdminWhatsApp(adminMsg), 'WhatsApp admin notification failed');
      if (sendConfirmationEmail) {
        fireAndForget(
          () => sendConfirmationEmail(data.email, data.fullName, userMsg, { preferredCountry, desiredCourse }),
          'User confirmation email failed'
        );
      }
      if (sendAdminEmail) {
        fireAndForget(
          () =>
            sendAdminEmail({
              fullName: data.fullName,
              email: data.email,
              phone: data.phone,
              city: data.city,
              preferredCountry,
              desiredCourse,
              levelOfStudy: data.levelOfStudy
            }),
          'Admin email failed'
        );
      }

      res.json({ success: true, message: 'Registration received' });
    } catch (error) {
      console.error('Abroad registration error:', error);
      res.status(500).json({ success: false, error: 'Failed to submit registration', message: error.message });
    }
  }
);

app.get('/', (req, res) => {
  res.json({ message: 'Abroad Vision Carrerz Backend is running!', version: '1.0.0', timestamp: new Date() });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'backend', timestamp: new Date().toISOString() });
});

// WhatsApp diagnostics: shows which business/test number is sending messages.
app.get('/api/whatsapp-sender', async (req, res) => {
  try {
    if (!getWhatsAppSenderInfo) {
      return res.status(501).json({ success: false, error: 'WhatsApp diagnostics not available' });
    }
    const info = await getWhatsAppSenderInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch WhatsApp sender info', message: err?.message || String(err) });
  }
});

app.get('/api/registrations', async (req, res) => {
  try {
    const [registrations] = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC');
    res.json({ success: true, count: registrations.length, data: registrations });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch registrations', message: error.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const [existingUsers] = await pool.query('SELECT * FROM registrations WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO registrations (full_name, email, phone, password) VALUES (?, ?, ?, ?)',
      [fullName, email, phone, hashedPassword]
    );

    const username = email.split('@')[0];
    await pool.query('INSERT INTO logins (user_id, email, username, password) VALUES (?, ?, ?, ?)', [
      result.insertId,
      email,
      username,
      hashedPassword
    ]);

    const adminMsg = `New Signup ✅\nName: ${fullName}\nEmail: ${email}\nPhone: ${phone}`;
    if (sendAdminWhatsApp) fireAndForget(() => sendAdminWhatsApp(adminMsg), 'WhatsApp admin notification failed');

    res.status(201).json({ success: true, message: 'Registration successful!', data: { id: result.insertId, fullName, email, phone } });
  } catch (error) {
    console.error('Registration error:', error);
    const message = error?.sqlMessage || error?.message || '';
    const code = error?.code || '';
    res.status(500).json({ success: false, error: 'Registration failed', message: code ? `${code} ${message}` : message });
  }
});

// Update registration details (used by Profile -> Edit)
app.put('/api/update-registration', async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const [rows] = await pool.query('SELECT id FROM registrations WHERE email = ? LIMIT 1', [email]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Registration not found' });
    }

    const updates = [];
    const values = [];

    if (fullName) {
      updates.push('full_name = ?');
      values.push(fullName);
    }
    if (phone) {
      updates.push('phone = ?');
      values.push(phone);
    }

    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 12);
      updates.push('password = ?');
      values.push(hashedPassword);
    }

    if (updates.length === 0) {
      return res.json({ success: true, message: 'No changes to update' });
    }

    values.push(email);
    await pool.query(`UPDATE registrations SET ${updates.join(', ')} WHERE email = ?`, values);

    if (hashedPassword) {
      // Keep logins table in sync
      await pool.query('UPDATE logins SET password = ? WHERE email = ? OR username = ?', [hashedPassword, email, email.split('@')[0]]);
    }

    res.json({ success: true, message: 'Registration updated successfully' });
  } catch (error) {
    console.error('Update registration error:', error);
    const message = error?.sqlMessage || error?.message || '';
    const code = error?.code || '';
    res.status(500).json({ success: false, error: 'Update failed', message: code ? `${code} ${message}` : message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const [loginRows] = await pool.query(
      `SELECT l.id AS login_id, l.user_id, l.email, l.username, l.password AS hash, l.last_login,
              r.full_name, r.phone
       FROM logins l
       LEFT JOIN registrations r ON r.id = l.user_id
       WHERE l.email = ? OR l.username = ?
       LIMIT 1`,
      [email, email]
    );

    if (loginRows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const loginRecord = loginRows[0];
    const isMatch = await bcrypt.compare(password, loginRecord.hash);

    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    await pool.query('UPDATE logins SET last_login = NOW() WHERE id = ?', [loginRecord.login_id]);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        loginId: loginRecord.login_id,
        userId: loginRecord.user_id,
        fullName: loginRecord.full_name,
        email: loginRecord.email,
        phone: loginRecord.phone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    const message = error?.sqlMessage || error?.message || '';
    const code = error?.code || '';
    res.status(500).json({ success: false, error: 'Login failed', message: code ? `${code} ${message}` : message });
  }
});

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const hashResetCode = (code) => {
  const pepper = String(process.env.RESET_PASSWORD_PEPPER || '');
  return crypto.createHash('sha256').update(String(code) + pepper).digest('hex');
};

// Forgot password - sends a short-lived 6-digit code via email.
// Security: do not reveal whether an email exists.
app.post('/api/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // Always respond success (avoid account enumeration)
    res.json({
      success: true,
      message: 'If an account exists for this email, a password reset code has been sent.'
    });

    // Continue in background (best-effort)
    const [rows] = await pool.query('SELECT email FROM logins WHERE email = ? LIMIT 1', [email]);
    if (rows.length === 0) return;

    const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
    const codeHash = hashResetCode(code);

    // Invalidate previous active codes
    await pool.query(
      'UPDATE password_reset_codes SET used_at = NOW() WHERE email = ? AND used_at IS NULL AND expires_at > NOW()',
      [email]
    );

    await pool.query(
      'INSERT INTO password_reset_codes (email, code_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))',
      [email, codeHash]
    );

    const mailed = await (sendPasswordResetCodeEmail ? sendPasswordResetCodeEmail(email, code) : false);
    if (!mailed) {
      console.warn('Password reset email not sent; code (for dev only):', code);
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    // Do not change response here because we already responded.
  }
});

// Reset password - verifies code and updates password hash.
app.post('/api/reset-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !code || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email, code, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const [codeRows] = await pool.query(
      `SELECT id, code_hash, expires_at
       FROM password_reset_codes
       WHERE email = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (codeRows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    const record = codeRows[0];
    const expiresAt = new Date(record.expires_at);
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    const expectedHash = String(record.code_hash || '');
    const actualHash = hashResetCode(code);
    if (actualHash !== expectedHash) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const username = email.split('@')[0];

    await pool.query('UPDATE registrations SET password = ? WHERE email = ?', [hashedPassword, email]);
    await pool.query('UPDATE logins SET password = ? WHERE email = ? OR username = ?', [hashedPassword, email, username]);

    await pool.query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?', [record.id]);

    // Best-effort notifications (do not block response on these)
    fireAndForget(async () => {
      const [nameRows] = await pool.query('SELECT full_name FROM registrations WHERE email = ? LIMIT 1', [email]);
      const fullName = nameRows?.[0]?.full_name || email;

      // Admin WhatsApp alert via Meta template
      if (sendAdminWhatsAppTemplate) {
        await sendAdminWhatsAppTemplate('security_alert', [fullName, email]);
      } else if (sendAdminWhatsApp) {
        await sendAdminWhatsApp(`User ${fullName} with Email ${email} has successfully reset their password.`);
      }

      // User email confirmation
      if (sendPasswordChangedEmail) {
        await sendPasswordChangedEmail(email, fullName);
      }
    }, 'Post-reset notifications failed');

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    const message = error?.sqlMessage || error?.message || '';
    const code = error?.code || '';
    res.status(500).json({ success: false, error: 'Password reset failed', message: code ? `${code} ${message}` : message });
  }
});

// Verify reset code (used by frontend to unlock password fields)
app.post('/api/verify-reset-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'Invalid reset code' });
    }

    const [codeRows] = await pool.query(
      `SELECT id, code_hash, expires_at
       FROM password_reset_codes
       WHERE email = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (codeRows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    const record = codeRows[0];
    const expiresAt = new Date(record.expires_at);
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    const expectedHash = String(record.code_hash || '');
    const actualHash = hashResetCode(code);
    if (actualHash !== expectedHash) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
    }

    return res.json({ success: true, message: 'Code verified' });
  } catch (error) {
    console.error('Verify reset code error:', error);
    const message = error?.sqlMessage || error?.message || '';
    const code = error?.code || '';
    res.status(500).json({ success: false, error: 'Verification failed', message: code ? `${code} ${message}` : message });
  }
});

app.get('/api/registration/:id', async (req, res) => {
  try {
    const [registrations] = await pool.query('SELECT * FROM registrations WHERE id = ?', [req.params.id]);
    if (registrations.length === 0) {
      return res.status(404).json({ success: false, error: 'Registration not found' });
    }
    res.json({ success: true, data: registrations[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch registration', message: error.message });
  }
});

app.put('/api/registration/:id', async (req, res) => {
  try {
    const { fullName, email, phone, visaType, city, country } = req.body;
    const [result] = await pool.query(
      'UPDATE registrations SET full_name = ?, email = ?, phone = ?, visa_type = ?, city = ?, country = ? WHERE id = ?',
      [fullName, email, phone, visaType, city, country, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Registration not found' });
    }
    res.json({ success: true, message: 'Registration updated successfully', data: { id: req.params.id, fullName, email, phone, visaType, city, country } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update registration', message: error.message });
  }
});

app.delete('/api/registration/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM registrations WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Registration not found' });
    }
    res.json({ success: true, message: 'Registration deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete registration', message: error.message });
  }
});

app.post('/api/additional-info', async (req, res) => {
  try {
    const payload = req.body;
    const requiredFields = ['first_name', 'date_of_birth', 'gender', 'degree', 'field', 'cgpa', 'study_destination', 'desired_course', 'intake_term', 'passport_id', 'email', 'nationality'];
    const missingField = requiredFields.find((key) => !payload[key]);
    if (missingField) {
      return res.status(400).json({ success: false, error: `${missingField} is required` });
    }

    const [result] = await pool.query(
      `INSERT INTO additional_info (first_name, date_of_birth, gender, degree, field, cgpa, study_destination, desired_course, intake_term, passport_id, passport_expiry, test_score, email, nationality)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.first_name,
        payload.date_of_birth,
        payload.gender,
        payload.degree,
        payload.field,
        payload.cgpa,
        payload.study_destination,
        payload.desired_course,
        payload.intake_term,
        payload.passport_id,
        payload.passport_expiry || null,
        payload.test_score || null,
        payload.email,
        payload.nationality
      ]
    );

    const adminMsg = `New application ✅\nName: ${payload.first_name}\nEmail: ${payload.email}`;
    const userMsg = `Your application was submitted successfully. Our counselors will contact you soon.`;
    if (sendConfirmationEmail) fireAndForget(() => sendConfirmationEmail(payload.email, payload.first_name, userMsg), 'User confirmation email failed');
    if (sendAdminEmail) fireAndForget(() => sendAdminEmail({ fullName: payload.first_name, email: payload.email }), 'Admin email failed');
    if (sendAdminWhatsApp) fireAndForget(() => sendAdminWhatsApp(adminMsg), 'WhatsApp admin notification failed');

    res.status(201).json({ success: true, message: 'Application submitted successfully!', data: { id: result.insertId } });
  } catch (error) {
    console.error('Additional info error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit application', message: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`\n✓ Server is running on http://localhost:${PORT}`);
  console.log('✓ Ready to receive registrations');
});

const shutdown = async (signal) => {
  console.log(`\n⏻ Shutting down (${signal})...`);
  server.close(() => console.log('✓ HTTP server closed'));

  try {
    if (pool?.end) await pool.end();
    console.log('✓ MySQL pool closed');
  } catch (e) {
    console.warn('⚠️ MySQL pool close failed:', e?.message || e);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n✗ Port ${PORT} is already in use.`);
    console.error('  - Stop the other running server (Ctrl+C)');
    console.error('  - or run with a different port, e.g. PowerShell:  $env:PORT=5001; npm start');

    findListeningPid(PORT)
      .then((pid) => {
        if (pid) {
          console.error(`  - Detected listener PID: ${pid}`);
          console.error(`  - Kill it (PowerShell): taskkill /PID ${pid} /F`);
        }
      })
      .finally(() => process.exit(1));

    return;
  }
  throw err;
});
