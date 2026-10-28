// npm run db:setup   → siapkan / migrasi database (data kamu tidak diubah)
// npm run db:sample  → sama, ditambah data contoh (hanya untuk database kosong)
import { migrate } from './migrate.js';

const sample = process.argv.includes('--sample');
try {
  const { created, sampleInserted } = await migrate(process.env.DATABASE_URL, { sample });
  if (created) console.log('Database dibuat.');
  console.log('Schema siap.');
  if (sampleInserted) console.log('Data contoh dimasukkan.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
