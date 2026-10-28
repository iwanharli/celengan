import { Router } from 'express';
import { HttpError } from '../db.js';
import { resetData, listAutoBackups, writeSafetyBackup } from '../backup.js';

// Backup berjalan otomatis di server (harian + sebelum aksi besar). Dari aplikasi hanya:
//   - melihat status backup otomatis
//   - "Mulai dari nol"
// Memulihkan backup dilakukan lewat terminal: npm run restore -- <file>
const router = Router();

const RESET_CONFIRMATION = 'HAPUS';

// Mulai dari nol (mis. menghapus data contoh). Wajib mengetik "HAPUS" sebagai konfirmasi.
router.post('/reset', async (req, res) => {
  if (req.body.confirm !== RESET_CONFIRMATION) {
    throw new HttpError(400, `Ketik ${RESET_CONFIRMATION} untuk konfirmasi`);
  }
  const backupFile = await writeSafetyBackup('mulai-dari-nol');
  await resetData();
  res.json({ backupFile });
});

// Status backup otomatis (nama file & waktu saja, isinya tidak bisa diunduh dari aplikasi).
router.get('/auto', async (req, res) => {
  res.json(await listAutoBackups());
});

export default router;
