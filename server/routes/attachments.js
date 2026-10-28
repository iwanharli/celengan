import { Router, raw } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { query, HttpError } from '../db.js';

// Foto/bukti transaksi. File disimpan di folder uploads/ (bisa diganti lewat UPLOAD_DIR),
// dengan nama acak supaya tidak bisa ditebak. Hanya bisa diakses setelah login (dipasang di bawah /api).

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? pathToFileURL(`${process.env.UPLOAD_DIR.replace(/\/$/, '')}/`)
  : new URL('../../uploads/', import.meta.url);

const MAX_BYTES = 8 * 1024 * 1024;   // per file (foto sudah dikecilkan di browser)
const MAX_PER_TRANSACTION = 10;

// Jenis file yang diterima + "tanda tangan" byte awalnya, supaya file bukan-gambar ditolak
// walaupun namanya diakhiri .jpg.
const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: 'webp', matches: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', matches: (b) => b.subarray(0, 4).toString() === 'GIF8' },
  'image/heic': { ext: 'heic', matches: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  'image/heif': { ext: 'heif', matches: (b) => b.subarray(4, 8).toString() === 'ftyp' },
};

const router = Router();
const fileUrl = (name) => new URL(name, UPLOAD_DIR);

// Unggah satu foto: body = isi file mentah, Content-Type = jenis gambar, header X-File-Name = nama asli.
router.post(
  '/transactions/:id/attachments',
  raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_BYTES }),
  async (req, res) => {
    const type = IMAGE_TYPES[req.headers['content-type']];
    if (!type || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'Hanya file gambar (JPG, PNG, WEBP, GIF, HEIC) yang bisa diunggah');
    }
    if (!type.matches(req.body)) throw new HttpError(400, 'Isi file bukan gambar yang valid');

    const [transaction] = await query('SELECT id FROM transactions WHERE id = $1', [req.params.id]);
    if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan');
    const [{ count }] = await query(
      'SELECT count(*)::int AS count FROM transaction_attachments WHERE transaction_id = $1', [transaction.id],
    );
    if (count >= MAX_PER_TRANSACTION) throw new HttpError(400, `Maksimal ${MAX_PER_TRANSACTION} foto per transaksi`);

    const storedName = `${randomUUID()}.${type.ext}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(fileUrl(storedName), req.body);

    const originalName = decodeURIComponent(String(req.headers['x-file-name'] ?? '')).slice(0, 200) || null;
    const [attachment] = await query(
      `INSERT INTO transaction_attachments (transaction_id, stored_name, original_name, mime, size)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, original_name, mime, size, created_at`,
      [transaction.id, storedName, originalName, req.headers['content-type'], req.body.length],
    );
    res.status(201).json(attachment);
  },
);

// Tampilkan foto. Nama file tidak pernah berubah, jadi boleh di-cache browser.
router.get('/attachments/:id', async (req, res) => {
  const [attachment] = await query('SELECT * FROM transaction_attachments WHERE id = $1', [req.params.id]);
  if (!attachment) throw new HttpError(404, 'Foto tidak ditemukan');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(attachment.mime);
  res.sendFile(fileURLToPath(fileUrl(attachment.stored_name)), (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'File foto tidak ada di server' });
  });
});

router.delete('/attachments/:id', async (req, res) => {
  const [attachment] = await query('DELETE FROM transaction_attachments WHERE id = $1 RETURNING stored_name', [req.params.id]);
  if (attachment) await unlink(fileUrl(attachment.stored_name)).catch(() => {});
  res.status(204).end();
});

// Bersihkan file yang datanya sudah tidak ada (misal transaksinya dihapus), setelah 30 hari.
// Ditunda 30 hari supaya backup pengaman masih bisa dipulihkan lengkap dengan fotonya.
export async function removeOrphanUploads(olderThanDays = 30) {
  let files;
  try { files = await readdir(UPLOAD_DIR); } catch { return 0; }
  const used = new Set((await query('SELECT stored_name FROM transaction_attachments')).map((row) => row.stored_name));
  const cutoff = Date.now() - olderThanDays * 86400000;
  let removed = 0;
  for (const name of files.filter((file) => !used.has(file))) {
    const info = await stat(fileUrl(name));
    if (info.mtimeMs < cutoff) { await unlink(fileUrl(name)); removed += 1; }
  }
  return removed;
}

export default router;
