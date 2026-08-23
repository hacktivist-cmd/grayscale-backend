import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.NODE_ENV === 'production' 
  ? '/data/grayscale.db' 
  : path.join(__dirname, 'grayscale.db');

if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('Database deleted:', DB_PATH);
} else {
  console.log('Database file not found:', DB_PATH);
}
