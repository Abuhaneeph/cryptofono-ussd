// config/database.js
const mysql = require("mysql2");
require("dotenv").config();

// Create minimal connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Handle unexpected errors
pool.on('error', (err) => {
  console.error('Database error:', err);
});

// Export promise-based pool
module.exports = pool.promise();