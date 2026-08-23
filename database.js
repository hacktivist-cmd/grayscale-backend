import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let DB_PATH;
if (process.env.NODE_ENV === 'production') {
  const dataDir = '/data';
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`Created directory: ${dataDir}`);
    }
    fs.accessSync(dataDir, fs.constants.W_OK);
    DB_PATH = join(dataDir, 'grayscale.db');
    console.log(`Using production database at: ${DB_PATH}`);
  } catch (err) {
    console.warn(`Cannot use /data: ${err.message}. Falling back to local file.`);
    DB_PATH = join(__dirname, 'grayscale.db');
  }
} else {
  DB_PATH = join(__dirname, 'grayscale.db');
}

console.log(`Final database path: ${DB_PATH}`);

export async function initDB() {
  try {
    const db = await open({
      filename: DB_PATH,
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
        investment_size TEXT,
        avatar TEXT
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
        address TEXT,
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

    // Ensure avatar column exists
    try {
      await db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
    } catch (e) {
      // Column already exists
    }

    // Seed admin
    const adminExists = await db.get("SELECT * FROM users WHERE email = 'gs@ingray.com'");
    if (!adminExists) {
      const hash = await bcrypt.hash('gtrade', 10);
      await db.run("INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 500000.00, 'Verified', 'Active']);
      console.log('✅ Admin user created: gs@ingray.com / gtrade');
    }

    return db;
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  }
}

export async function ensureTables(db) {
  try {
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
  } catch (err) {
    console.error('❌ ensureTables error:', err);
    throw err;
  }
}
