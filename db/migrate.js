// Menyiapkan database: buat database bila belum ada, jalankan schema (aman diulang),
// isi kategori bawaan bila kosong, dan (opsional) data contoh.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const sqlFile = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

async function createDatabaseIfMissing(dbUrl) {
  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = '/postgres';
  const dbName = dbUrl.pathname.slice(1);

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
    return rowCount === 0;
  } finally {
    await admin.end();
  }
}

export async function migrate(connectionString, { sample = false } = {}) {
  const dbUrl = new URL(connectionString);
  const created = await createDatabaseIfMissing(dbUrl);

  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await db.query(await sqlFile('schema.sql'));

    const { rows: [categories] } = await db.query('SELECT count(*)::int AS n FROM categories');
    if (categories.n === 0) await db.query(await sqlFile('defaults.sql'));

    let sampleInserted = false;
    if (sample) {
      const { rows: [accounts] } = await db.query('SELECT count(*)::int AS n FROM accounts');
      if (accounts.n > 0) throw new Error('Data contoh hanya bisa dimasukkan ke database yang masih kosong.');
      await db.query(await sqlFile('sample.sql'));
      sampleInserted = true;
    }
    return { created, sampleInserted };
  } finally {
    await db.end();
  }
}
