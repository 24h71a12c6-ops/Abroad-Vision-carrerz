const mysql = require('mysql2/promise');
const path = require('path');

const { loadEnv } = require('../utils/loadEnv');

// Always load backend/.env (works even when started from workspace root)
// Use override:true so stale machine-level env vars don't win.
loadEnv(path.join(__dirname, '..', '.env'), { override: true });

const cleanEnv = (value, fallback = '') => {
    if (value === undefined || value === null) return fallback;
    // Allow inline comments in .env (e.g. "HOST=localhost # comment")
    return String(value).split('#')[0].trim();
};

const pool = mysql.createPool({
    host: cleanEnv(process.env.DB_HOST, 'localhost'),
    user: cleanEnv(process.env.DB_USER, 'root'),
    password: cleanEnv(process.env.DB_PASSWORD, ''),
    database: cleanEnv(process.env.DB_NAME, 'abroad_vision_carrerz'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connection
pool.getConnection()
    .then(connection => {
        console.log('✓ Connected to MySQL database');
        connection.release();
    })
    .catch(err => {
        const msg = err?.message || err?.sqlMessage || '';
        const code = err?.code || '';
        console.error('✗ MySQL connection error:', code ? `${code} ${msg}` : msg);
        if (!msg) console.error('✗ MySQL connection raw error:', err);
    });

module.exports = pool;
