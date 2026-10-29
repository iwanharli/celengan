import { Router } from 'express';
import { query, HttpError } from '../db.js';
import { vapidKeys, sendToAll } from '../notify.js';
import { collectNotifications } from '../inbox.js';

// Notifikasi browser (daftar/berhenti langganan & kirim tes) dan kotak notifikasi di aplikasi.
const router = Router();

// Kotak notifikasi: 100 terbaru + jumlah yang belum dibaca. ?collect=1 memeriksa kondisi terbaru dulu.
router.get('/inbox', async (req, res) => {
  if (req.query.collect) await collectNotifications();
  const [items, [{ unread }]] = await Promise.all([
    query(`SELECT * FROM notifications WHERE title <> '' ORDER BY created_at DESC, id DESC LIMIT 100`),
    query(`SELECT count(*)::int AS unread FROM notifications WHERE read_at IS NULL AND title <> ''`),
  ]);
  res.json({ items, unread, loaded: true });
});

router.post('/inbox/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL');
  res.status(204).end();
});

router.post('/inbox/:id/read', async (req, res) => {
  await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// Hapus yang sudah dibaca (kunci tetap disimpan supaya kondisi yang sama tidak muncul lagi).
router.delete('/inbox/read', async (req, res) => {
  await query(`UPDATE notifications SET title = '', body = NULL WHERE read_at IS NOT NULL`);
  res.status(204).end();
});

router.delete('/inbox/:id', async (req, res) => {
  await query(`UPDATE notifications SET title = '', body = NULL, read_at = COALESCE(read_at, now()) WHERE id = $1`, [req.params.id]);
  res.status(204).end();
});

router.get('/', async (req, res) => {
  const [{ publicKey }, [{ count }]] = await Promise.all([
    vapidKeys(),
    query('SELECT count(*)::int AS count FROM push_subscriptions'),
  ]);
  res.json({ publicKey, devices: count });
});

router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body.subscription ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new HttpError(400, 'Langganan notifikasi tidak valid');
  await query(
    `INSERT INTO push_subscriptions (endpoint, keys, device) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys, device = EXCLUDED.device`,
    [endpoint, keys, String(req.body.device ?? '').slice(0, 120) || null],
  );
  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [req.body.endpoint]);
  res.status(204).end();
});

router.post('/test', async (req, res) => {
  const sent = await sendToAll({ title: 'Pengingat Celengan aktif 🐷', body: 'Kamu akan diingatkan H-1 dan di hari jatuh tempo tagihan.', url: '/#bills', tag: 'test' });
  if (!sent) throw new HttpError(400, 'Belum ada browser yang mengaktifkan pengingat');
  res.json({ sent });
});

export default router;
