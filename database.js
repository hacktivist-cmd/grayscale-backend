import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function initDB() {
  const db = await open({
    filename: join(__dirname, 'grayscale.db'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      investment_size TEXT
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      symbol TEXT,
      holdings REAL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      asset TEXT,
      amount TEXT,
      usd_value TEXT,
      date TEXT,
      status TEXT DEFAULT 'Completed',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      user_name TEXT,
      amount TEXT,
      asset TEXT,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'Pending',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      user_name TEXT,
      amount TEXT,
      asset TEXT,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'Pending',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      asset TEXT,
      amount_invested REAL,
      profit_percent REAL DEFAULT 30.0,
      profit_amount REAL,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Seed only the admin user (no other users, no assets)
  const adminExists = await db.get("SELECT * FROM users WHERE email = 'admin@grayscale.com'");
  if (!adminExists) {
    const hash = await bcrypt.hash('Admin123!', 10);
    await db.run("INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['System', 'Admin', 'admin@grayscale.com', hash, 'admin', 500000.00, 'Verified', 'Active']);
    console.log('✅ Created admin@grayscale.com / Admin123!');
  }

  return db;
}

// Ensure investments table exists (re-run if needed)
export async function ensureTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      asset TEXT,
      amount_invested REAL,
      profit_percent REAL DEFAULT 30.0,
      profit_amount REAL,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'active',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
}
