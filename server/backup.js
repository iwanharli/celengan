import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { query, withTransaction, HttpError } from './db.js';

// Backup berisi SEMUA data keuangan (bukan akun login/password).
// Urutan tabel penting: tabel induk dulu, supaya relasi (foreign key) terpenuhi saat restore.
const DATA_TABLES = [
  'categories', 'accounts', 'assets', 'debts', 'debt_installments', 'bills',
  'wishlist_items', 'wishlist_parts', 'transactions', 'transaction_attachments', 'wishlist_events', 'net_worth_snapshots',
  'transaction_templates', 'transaction_history', 'bill_skips',
];
// Tabel yang dikosongkan saat "Mulai dari nol" (kategori & pengaturan dipertahankan).
const USER_DATA_TABLES = DATA_TABLES.filter((table) => table !== 'categories');

const BACKUP_FORMAT = { app: 'catat-keuangan', version: 1 };
// Folder backup bisa diganti lewat BACKUP_DIR (dipakai test agar tidak mengotori backups/).
const AUTO_BACKUP_DIR = process.env.BACKUP_DIR
  ? pathToFileURL(`${process.env.BACKUP_DIR.replace(/\/$/, '')}/`)
  : new URL('../backups/', import.meta.url);
const AUTO_BACKUP_KEEP = 14;   // backup harian
const SAFETY_BACKUP_KEEP = 20; // backup sebelum aksi besar (gabung kategori, restore, mulai dari nol)
const BACKUP_NAME = /^(auto-\d{4}-\d{2}-\d{2}|sebelum-[a-z0-9-]+-\d{8}-\d{6})\.json$/;

async function keepNewest(prefix, keep) {
  const files = (await readdir(AUTO_BACKUP_DIR)).filter((name) => name.startsWith(prefix)).sort();
  for (const old of files.slice(0, -keep)) await unlink(new URL(old, AUTO_BACKUP_DIR));
}

export async function exportData() {
  const data = {};
  for (const table of DATA_TABLES) data[table] = await query(`SELECT * FROM ${table} ORDER BY 1`);
  const [settings] = await query('SELECT month_start_day, income_mode, tax_rate, tax_category_ids FROM settings WHERE id = 1');
  return { ...BACKUP_FORMAT, exported_at: new Date().toISOString(), settings, data };
}

export function validateBackup(backup) {
  if (backup?.app !== BACKUP_FORMAT.app || typeof backup.data !== 'object') {
    throw new HttpError(400, 'File ini bukan backup Catat Keuangan');
  }
  if (backup.version > BACKUP_FORMAT.version) {
    throw new HttpError(400, 'Backup dibuat oleh versi aplikasi yang lebih baru');
  }
  for (const table of DATA_TABLES) {
    if (!Array.isArray(backup.data[table] ?? [])) throw new HttpError(400, `Data "${table}" di backup rusak`);
  }
}

// Mengganti seluruh data dengan isi backup, dalam satu transaksi database (gagal = tidak ada yang berubah).
export async function restoreData(backup) {
  validateBackup(backup);
  await withTransaction(async (client) => {
    // Memasukkan ulang transaksi dari backup tidak perlu dicatat sebagai riwayat baru.
    await client.query("SET LOCAL celengan.skip_history = 'on'");
    await client.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);

    // wishlist_items.transaction_id menunjuk ke transactions, sementara transactions.wish_part_id
    // menunjuk ke wishlist_parts → wishlist_items. Jadi item dimasukkan tanpa transaction_id dulu,
    // lalu transaction_id diisi setelah transaksi dipulihkan.
    for (const table of DATA_TABLES) {
      let rows = backup.data[table] ?? [];
      if (rows.length === 0) continue;
      if (table === 'wishlist_items') rows = rows.map((row) => ({ ...row, transaction_id: null }));
      await client.query(
        `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
        [JSON.stringify(rows)],
      );
    }
    for (const item of (backup.data.wishlist_items ?? []).filter((row) => row.transaction_id)) {
      await client.query('UPDATE wishlist_items SET transaction_id = $1 WHERE id = $2', [item.transaction_id, item.id]);
    }

    // Lanjutkan penomoran id setelah id terbesar yang dipulihkan.
    for (const table of DATA_TABLES.filter((name) => name !== 'net_worth_snapshots')) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table}`,
      );
    }

    if (backup.settings) {
      const { month_start_day, income_mode, tax_rate = 0, tax_category_ids = [] } = backup.settings;
      await client.query(
        'UPDATE settings SET month_start_day = $1, income_mode = $2, tax_rate = $3, tax_category_ids = $4 WHERE id = 1',
        [month_start_day, income_mode, tax_rate, tax_category_ids],
      );
    }
  });
}

// "Mulai dari nol": hapus semua transaksi, akun, utang, aset, dll. Kategori & pengaturan tetap.
export async function resetData() {
  await query(`TRUNCATE ${USER_DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await query('UPDATE categories SET monthly_budget = NULL');
}

// ---------- Backup otomatis harian ke folder backups/ ----------

export async function writeAutoBackup(now = new Date()) {
  await mkdir(AUTO_BACKUP_DIR, { recursive: true });
  const fileName = `auto-${now.toLocaleDateString('sv-SE')}.json`;
  await writeFile(new URL(fileName, AUTO_BACKUP_DIR), JSON.stringify(await exportData()));

  await keepNewest('auto-', AUTO_BACKUP_KEEP);
  return fileName;
}

// Backup pengaman sebelum aksi yang tidak bisa dibatalkan.
// label contoh: "gabung-kategori-kopi" → sebelum-gabung-kategori-kopi-20261028-143005.json
export async function writeSafetyBackup(label) {
  await mkdir(AUTO_BACKUP_DIR, { recursive: true });
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'aksi';
  const stamp = new Date().toLocaleString('sv-SE').replace(/\D/g, '').replace(/^(\d{8})/, '$1-');
  const fileName = `sebelum-${slug}-${stamp}.json`;
  await writeFile(new URL(fileName, AUTO_BACKUP_DIR), JSON.stringify(await exportData()));
  await keepNewest('sebelum-', SAFETY_BACKUP_KEEP);
  return fileName;
}

export async function listAutoBackups() {
  let files;
  try {
    files = (await readdir(AUTO_BACKUP_DIR)).filter((name) => BACKUP_NAME.test(name));
  } catch {
    return [];
  }
  const list = await Promise.all(files.map(async (name) => {
    const info = await stat(new URL(name, AUTO_BACKUP_DIR));
    return { name, kind: name.startsWith('auto-') ? 'daily' : 'safety', size: info.size, created_at: info.mtime };
  }));
  return list.sort((a, b) => b.created_at - a.created_at);
}

export function autoBackupPath(name) {
  if (!BACKUP_NAME.test(name)) throw new HttpError(400, 'Nama file backup tidak valid');
  return new URL(name, AUTO_BACKUP_DIR);
}

export function scheduleAutoBackup() {
  const run = () => writeAutoBackup().catch((error) => console.error('Backup otomatis gagal:', error.message));
  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
