import { initDB } from './database.js';

async function updateSchema() {
  const db = await initDB();

  // libsql doesn't have .exec() — use batch() for multiple statements,
  // and wrap each ALTER in try/catch because "column exists" is fine.
  const alters = [
    "ALTER TABLE users ADD COLUMN phone TEXT;",
    "ALTER TABLE users ADD COLUMN country TEXT;",
    "ALTER TABLE users ADD COLUMN accredited_investor TEXT;",
    "ALTER TABLE users ADD COLUMN investment_size TEXT;",
    "ALTER TABLE users ADD COLUMN avatar TEXT;"
  ];

  for (const sql of alters) {
    try {
      await db.execute(sql);
      console.log('✔', sql);
    } catch (e) {
      console.log('⏭  skipped (already exists):', sql);
    }
  }

  console.log('✅ Database schema updated with additional fields.');
  await db.close();
}

updateSchema().catch(err => { console.error(err); process.exit(1); });
