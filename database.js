import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';

let db;

export function getDb() {
  if (!db) {
    let url = process.env.TURSO_DATABASE_URL?.trim();
    const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

    if (!url) {
      // local fallback so it doesn't crash during dev
      url = 'file:grayscale.db';
      console.warn('⚠️  TURSO_DATABASE_URL not set, falling back to local file DB');
    }

    if (url.toLowerCase().startsWith('libsql://')) {
      url = url.replace(/libsql:\/\//i, 'https://');
    }

    db = createClient({ url, authToken });
    console.log('✅ Connected to DB:', url);
  }
  return db;
}

export async function initDB() {
  const client = getDb();
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      balance_usd REAL DEFAULT 0.00,
      kyc_status TEXT DEFAULT 'Pending',
      status TEXT DEFAULT 'Active',
      phone TEXT,
      country TEXT,
      accredited_investor TEXT,
      investment_size TEXT,
      avatar TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      symbol TEXT,
      holdings REAL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      type TEXT,
      asset TEXT,
      amount TEXT,
      usd_value TEXT,
      date TEXT,
      status TEXT DEFAULT 'Completed',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`,
    `CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      user_name TEXT,
      amount TEXT,
      asset TEXT,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'Pending',
      address TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`,
    `CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      user_name TEXT,
      amount TEXT,
      asset TEXT,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'Pending',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`,
    `CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      asset TEXT,
      amount_invested REAL,
      profit_percent REAL DEFAULT 30.0,
      profit_amount REAL,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`
  ];

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err) {
      console.error('Table error:', err.message);
    }
  }

  // Add avatar column if it doesn't exist (safe migration for existing DBs)
  try {
    await client.execute("ALTER TABLE users ADD COLUMN avatar TEXT;");
  } catch (e) { /* already exists */ }

  // Seed admin
  try {
    const admin = await client.execute({
      sql: "SELECT id FROM users WHERE email = ?",
      args: ['gs@ingray.com']
    });

    if (admin.rows.length === 0) {
      const hash = await bcrypt.hash('gtrade', 10);
      await client.execute({
        sql: "INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 500000.00, 'Verified', 'Active']
      });
      console.log('✅ Admin user seeded: gs@ingray.com / gtrade');
    }
  } catch (e) {
    console.error('Admin seed error:', e.message);
  }

  return client;
}
