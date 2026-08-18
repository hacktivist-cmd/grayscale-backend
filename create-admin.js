import { initDB } from './database.js';
import bcrypt from 'bcryptjs';

async function createAdmin() {
  const db = await initDB();

  // Hash the password
  const hash = await bcrypt.hash('gtrade', 10);

  // Insert the admin user
  await db.run(`
    INSERT INTO users (first_name, last_name, email, password_hash, role, balance_usd, kyc_status, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, ['System', 'Admin', 'gs@ingray.com', hash, 'admin', 0.00, 'Verified', 'Active']);

  console.log('✅ Admin user created: gs@ingray.com / gtrade');
  await db.close();
}

createAdmin().catch(console.error);
