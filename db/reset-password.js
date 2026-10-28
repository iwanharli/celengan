// Lupa password? Jalankan: npm run reset-password -- "passwordBaru"
// Semua sesi login lama otomatis dikeluarkan.
import pg from 'pg';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../server/password.js';

const newPassword = process.argv[2];
if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
  console.error(`Pakai: npm run reset-password -- "passwordBaru"  (minimal ${MIN_PASSWORD_LENGTH} karakter)`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rowCount } = await db.query('UPDATE owner SET password_hash = $1 WHERE id = 1', [await hashPassword(newPassword)]);
await db.query('DELETE FROM sessions');
await db.end();

console.log(rowCount ? 'Password berhasil diganti.' : 'Belum ada akun. Buka aplikasi untuk membuat password pertama kali.');
