import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { guessCategoryName, noteKey } from '../../public/js/statement.js';

// Import mutasi rekening. File dibaca di browser (public/js/statement.js); server hanya:
//   POST /preview : tebak kategori (riwayat keterangan serupa → kata kunci) & tandai yang kemungkinan sudah tercatat
//   POST /        : simpan baris terpilih sebagai transaksi, sekaligus dalam satu transaksi database
const router = Router();
const MAX_ROWS = 2000;

function validRows(body) {
  required(body, ['account_id', 'rows']);
  if (!Array.isArray(body.rows) || body.rows.length === 0) throw new HttpError(400, 'Tidak ada baris untuk diimport');
  if (body.rows.length > MAX_ROWS) throw new HttpError(400, `Maksimal ${MAX_ROWS} baris sekali import`);
  return body.rows;
}

router.post('/preview', async (req, res) => {
  const rows = validRows(req.body);
  const [history, categories, existing] = await Promise.all([
    // Kategori terakhir yang dipakai untuk keterangan serupa.
    query(
      `SELECT DISTINCT ON (kind, lower(note)) kind, note, category_id
       FROM transactions WHERE kind IN ('income', 'expense') AND note IS NOT NULL AND category_id IS NOT NULL
       ORDER BY kind, lower(note), date DESC, id DESC LIMIT 5000`,
    ),
    query('SELECT id, name, kind FROM categories WHERE NOT archived'),
    query(
      `SELECT date::text AS date, amount, kind FROM transactions
       WHERE account_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [req.body.account_id, rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date),
        rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date)],
    ),
  ]);
  const learned = new Map(history.map((row) => [`${row.kind}|${noteKey(row.note)}`, row.category_id]));
  const byName = new Map(categories.map((c) => [`${c.kind}|${c.name}`, c.id]));
  const fallback = { income: byName.get('income|Pemasukan Lain'), expense: byName.get('expense|Lainnya') };
  // Duplikat: tanggal, nominal & jenis sama di akun yang sama (dihitung, karena bisa ada 2 transaksi kembar sungguhan).
  const seen = new Map();
  for (const row of existing) seen.set(`${row.date}|${row.amount}|${row.kind}`, (seen.get(`${row.date}|${row.amount}|${row.kind}`) ?? 0) + 1);

  res.json(rows.map((row) => {
    const key = `${row.date}|${row.amount}|${row.kind}`;
    const duplicate = (seen.get(key) ?? 0) > 0;
    if (duplicate) seen.set(key, seen.get(key) - 1);
    const learnedId = learned.get(`${row.kind}|${noteKey(row.note)}`);
    const keywordId = byName.get(`${row.kind}|${guessCategoryName(row.note)}`);
    return {
      ...row,
      duplicate,
      category_id: learnedId ?? keywordId ?? fallback[row.kind] ?? null,
      guessed_by: learnedId ? 'history' : keywordId ? 'keyword' : 'default',
    };
  }));
});

router.post('/', async (req, res) => {
  const rows = validRows(req.body);
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') || !(Number(row.amount) > 0) || !['income', 'expense'].includes(row.kind) || !row.category_id) {
      throw new HttpError(400, 'Ada baris yang belum lengkap (tanggal, nominal, jenis, atau kategori)');
    }
  }
  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO transactions (kind, amount, account_id, category_id, date, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.kind, Math.round(Number(row.amount)), req.body.account_id, row.category_id, row.date, String(row.note ?? '').slice(0, 300) || null],
      );
    }
  });
  res.status(201).json({ imported: rows.length });
});

export default router;
