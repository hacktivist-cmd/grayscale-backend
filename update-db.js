import { initDB } from './database.js';

async function updateSchema() {
  const db = await initDB();
  // Add missing columns if they don't exist
  await db.exec(`
    ALTER TABLE users ADD COLUMN phone TEXT;
    ALTER TABLE users ADD COLUMN country TEXT;
    ALTER TABLE users ADD COLUMN accredited_investor TEXT;
    ALTER TABLE users ADD COLUMN investment_size TEXT;
  `);
  console.log('✅ Database schema updated with additional fields.');
  await db.close();
}
updateSchema().catch(console.error);
