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
    )`,
    `CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      symbol TEXT,
      holdings REAL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`,
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
    )`,
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
    )`,
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
    )`,
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
    )`
  ];

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err) {
      console.error('Table error:', err.message);
    }
  }

  // Safely attempt adding avatar column without throwing on failure
  try {
    await client.execute("ALTER TABLE users ADD COLUMN avatar TEXT");
  } catch (e) {
    // Column already exists or table exists with avatar column included
  }

  // Seed admin user
  try {
    const admin = await client.execute("SELECT * FROM users WHERE email = 'gs@ingray.com'");
    if (admin.rows.length === 0) {
      const hash = await bcrypt.hash('gtrade', 10);
      await client.execute({
        sql: "INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 500000.00, 'Verified', 'Active']
      });
    }
  } catch (e) {
    console.error('Admin seed error:', e.message);
  }

  return client;
}
