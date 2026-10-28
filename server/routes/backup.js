import { Router } from 'express';
import { HttpError } from '../db.js';
import { query } from '../db.js';
import {
  resetData, listAutoBackups, writeSafetyBackup, writeAutoBackup, mirrorStatus, mirrorSuggestions, checkMirrorDir,
} from '../backup.js';

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

// Salinan backup ke folder kedua (iCloud Drive / Google Drive / ...).
router.get('/mirror', async (req, res) => {
  res.json({ ...(await mirrorStatus()), suggestions: await mirrorSuggestions() });
});

// Atur folder lalu langsung buat backup + salinannya, supaya kelihatan berhasil atau tidak.
router.put('/mirror', async (req, res) => {
  const dir = String(req.body.dir ?? '').trim().replace(/\/+$/, '');
  await checkMirrorDir(dir);
  await query('UPDATE settings SET backup_mirror_dir = $1, backup_mirror_error = NULL WHERE id = 1', [dir]);
  await writeAutoBackup();
  res.json(await mirrorStatus());
});

router.delete('/mirror', async (req, res) => {
  await query('UPDATE settings SET backup_mirror_dir = NULL, backup_mirror_at = NULL, backup_mirror_error = NULL WHERE id = 1');
  res.status(204).end();
});

export default router;
