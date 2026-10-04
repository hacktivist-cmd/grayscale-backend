import { initDB } from './database.js';
import bcrypt from 'bcryptjs';

async function createAdmin() {
  const db = await initDB();

  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: ['gs@ingray.com']
  });

  if (existing.rows.length > 0) {
    console.log('ℹ️  Admin already exists: gs@ingray.com');
    await db.close();
    return;
  }

  const hash = await bcrypt.hash('gtrade', 10);

  await db.execute({
    sql: `INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 0.00, 'Verified', 'Active']
  });

  console.log('✅ Admin user created: gs@ingray.com / gtrade');
  await db.close();
}

createAdmin().catch(err => { console.error(err); process.exit(1); });
