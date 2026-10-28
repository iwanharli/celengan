import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { query, required, HttpError } from '../db.js';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../password.js';

const router = Router();

const COOKIE_NAME = 'sid';
const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// ---------- Sesi & cookie ----------

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function readSessionToken(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? '').split(';').map((part) => part.trim().split('=')),
  );
  return cookies[COOKIE_NAME];
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

async function startSession(res) {
  const token = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO sessions (token_hash, expires_at) VALUES ($1, now() + $2::interval)`,
    [hashToken(token), `${SESSION_DAYS} days`],
  );
  await query('DELETE FROM sessions WHERE expires_at < now()');
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}

async function isLoggedIn(req) {
  const token = readSessionToken(req);
  if (!token) return false;
  const rows = await query(
    'SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [hashToken(token)],
  );
  return rows.length > 0;
}

// Middleware untuk semua endpoint data.
export async function requireLogin(req, res, next) {
  if (await isLoggedIn(req)) return next();
  res.status(401).json({ error: 'Silakan login terlebih dahulu' });
}

// ---------- Pembatasan percobaan login (anti tebak password) ----------

const failedAttempts = new Map(); // ip -> { count, lockedUntil }

function checkNotLocked(ip) {
  const entry = failedAttempts.get(ip);
  if (entry?.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`);
  }
}

function recordFailure(ip) {
  const entry = failedAttempts.get(ip) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
  }
  failedAttempts.set(ip, entry);
}

function checkPasswordStrength(password) {
  if (String(password ?? '').length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }
}

const getOwner = async () => (await query('SELECT * FROM owner WHERE id = 1'))[0];

// ---------- Endpoint ----------

router.get('/status', async (req, res) => {
  const owner = await getOwner();
  res.json({
    hasOwner: Boolean(owner),
    loggedIn: owner ? await isLoggedIn(req) : false,
    name: owner && (await isLoggedIn(req)) ? owner.name : null,
  });
});

// Hanya bisa dipakai sekali: saat aplikasi belum punya pemilik.
router.post('/setup', async (req, res) => {
  required(req.body, ['name', 'password']);
  checkPasswordStrength(req.body.password);
  const rows = await query(
    `INSERT INTO owner (id, name, password_hash) VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [req.body.name.trim(), await hashPassword(req.body.password)],
  );
  if (rows.length === 0) throw new HttpError(403, 'Akun pemilik sudah dibuat');
  await startSession(res);
  res.status(201).json({ ok: true });
});

router.post('/login', async (req, res) => {
  checkNotLocked(req.ip);
  const owner = await getOwner();
  if (!owner) throw new HttpError(400, 'Buat password terlebih dahulu');

  if (!(await verifyPassword(String(req.body.password ?? ''), owner.password_hash))) {
    recordFailure(req.ip);
    throw new HttpError(401, 'Password salah');
  }
  failedAttempts.delete(req.ip);
  await startSession(res);
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  setSessionCookie(res, '', 0);
  res.status(204).end();
});

// Ganti password: semua sesi lain ikut dikeluarkan, sesi ini tetap login.
router.put('/password', requireLogin, async (req, res) => {
  required(req.body, ['current_password', 'new_password']);
  checkPasswordStrength(req.body.new_password);
  const owner = await getOwner();
  if (!(await verifyPassword(req.body.current_password, owner.password_hash))) {
    throw new HttpError(400, 'Password lama salah');
  }
  await query('UPDATE owner SET password_hash = $1 WHERE id = 1', [await hashPassword(req.body.new_password)]);
  await query('DELETE FROM sessions');
  await startSession(res);
  res.json({ ok: true });
});

export default router;
