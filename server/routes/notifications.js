import { Router } from 'express';
import { query, HttpError } from '../db.js';
import { vapidKeys, sendToAll } from '../notify.js';

// Pengingat tagihan: daftar/berhenti langganan notifikasi browser & kirim tes.
const router = Router();

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
