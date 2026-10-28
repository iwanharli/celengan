// Pulihkan data dari file backup (keadaan darurat / pindah laptop).
//   npm run restore -- backups/auto-2026-10-28.json
// SEMUA data sekarang diganti isi file. Sebelumnya dibuat backup pengaman otomatis.
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error('Pakai: npm run restore -- <file backup .json>   (lihat folder backups/)');
  process.exit(1);
}

const { restoreData, validateBackup, writeSafetyBackup } = await import('../server/backup.js');
const { pool } = await import('../server/db.js');
try {
  const backup = JSON.parse(await readFile(file, 'utf8'));
  validateBackup(backup);
  const safety = await writeSafetyBackup('pulihkan-backup');
  await restoreData(backup);
  console.log(`Data dipulihkan dari ${file} (dibuat ${backup.exported_at}).`);
  console.log(`Data sebelumnya disimpan di folder backup: ${safety}`);
} catch (error) {
  console.error(`Gagal memulihkan: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
