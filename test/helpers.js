// Menjalankan aplikasi asli (Express + PostgreSQL) untuk test, memakai database terpisah.
// Default: postgres://localhost:5432/catat_keuangan_test (ubah lewat TEST_DATABASE_URL).
// Data kamu di database utama TIDAK disentuh.
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/catat_keuangan_test';

const ALL_TABLES = [
  'wishlist_events', 'wishlist_parts', 'wishlist_items', 'transaction_attachments', 'transaction_templates',
  'transaction_history', 'transactions', 'bills', 'debt_installments', 'debts',
  'assets', 'accounts', 'net_worth_snapshots', 'categories', 'sessions', 'owner',
  'recipients', 'bill_skips', 'bill_reminders', 'push_subscriptions', 'notifications',
];

export async function startTestApp() {
  process.env.DATABASE_URL = TEST_DATABASE_URL; // harus sebelum server/db.js di-import
  process.env.BACKUP_DIR = mkdtempSync(join(tmpdir(), 'catat-keuangan-test-')); // backup test tidak masuk backups/
  process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'catat-keuangan-upload-')); // foto test tidak masuk uploads/
  const { migrate } = await import('../db/migrate.js');
  const { pool } = await import('../server/db.js');
  const { createApp } = await import('../server/app.js');

  // Pengaman: jangan pernah menjalankan test (yang mengosongkan tabel) di database selain database test.
  // Bisa terjadi bila file test meng-import modul server sebelum helper ini mengatur DATABASE_URL.
  if (pool.options.connectionString !== TEST_DATABASE_URL) {
    throw new Error(`Test dibatalkan: terhubung ke "${pool.options.connectionString}", bukan database test. `
      + 'Jangan import modul server/ di bagian atas file test.');
  }

  // Database bersih: schema terbaru + kategori bawaan saja.
  await migrate(TEST_DATABASE_URL);
  await pool.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await migrate(TEST_DATABASE_URL);
  await pool.query(`UPDATE settings SET month_start_day = 1, income_mode = 'fixed'`);

  // Langsung login: buat pemilik & sesi tanpa lewat form.
  const token = randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO owner (id, name, password_hash) VALUES (1, 'Tes', 'x:x')`);
  await pool.query(
    `INSERT INTO sessions (token_hash, expires_at) VALUES ($1, now() + interval '1 hour')`,
    [createHash('sha256').update(token).digest('hex')],
  );

  const server = createApp().listen(0);
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // call() mengembalikan { status, data }; untuk dicek manual.
  async function call(method, path, body, { loggedIn = true } = {}) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(loggedIn ? { Cookie: `sid=${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return { status: response.status, data };
  }

  // Kirim / ambil file mentah (untuk foto transaksi).
  async function upload(path, body, contentType, fileName = 'foto.jpg', { loggedIn = true } = {}) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-File-Name': encodeURIComponent(fileName),
        ...(loggedIn ? { Cookie: `sid=${token}` } : {}),
      },
      body,
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }

  async function download(path, { loggedIn = true, body } = {}) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(loggedIn ? { Cookie: `sid=${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      fileName: response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1],
      body: Buffer.from(await response.arrayBuffer()),
    };
  }

  // api.get/post/put/delete: langsung data; gagal jika status bukan 2xx.
  const request = (method) => async (path, body) => {
    const { status, data } = await call(method, path, body);
    if (status >= 300) throw new Error(`${method} ${path} → ${status}: ${JSON.stringify(data)}`);
    return data;
  };

  const backup = await import('../server/backup.js');

  return {
    baseUrl,
    token, // cookie sid, untuk uji tampilan di browser (test/ui-smoke.mjs)
    exportData: backup.exportData,
    restoreData: backup.restoreData,
    pool,
    call,
    upload,
    download,
    api: { get: request('GET'), post: request('POST'), put: request('PUT'), delete: request('DELETE') },
    async close() {
      server.close();
      await pool.end();
    },
  };
}

// Cari id kategori bawaan berdasarkan nama (lihat db/defaults.sql).
export async function categoryId(api, name) {
  const category = (await api.get('/categories')).find((item) => item.name === name);
  if (!category) throw new Error(`Kategori "${name}" tidak ada`);
  return category.id;
}
