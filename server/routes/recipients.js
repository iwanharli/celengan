import { Router } from 'express';
import { query, required, HttpError } from '../db.js';

// Penerima: buku rekening tujuan kiriman uang (orang tua, keluarga, pasangan, teman, ...).
// Kiriman ke penerima = pengeluaran dengan recipient_id (lihat routes/transactions.js).
const router = Router();

const RELATIONS = ['parent', 'family', 'partner', 'friend', 'other'];
const METHODS = ['bank', 'ewallet', 'cash'];

router.get('/', async (req, res) => {
  res.json(await query(
    `SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            COALESCE(s.total, 0)::bigint AS total_sent,
            COALESCE(s.month_total, 0)::bigint AS month_sent,
            COALESCE(s.count, 0)::int AS sent_count,
            s.last_date, s.last_amount, s.last_account_id,
            (SELECT f.amount FROM transactions t JOIN transactions f ON f.fee_of = t.id
             WHERE t.recipient_id = r.id ORDER BY t.date DESC, t.id DESC LIMIT 1) AS last_fee
     FROM recipients r
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN LATERAL (
       SELECT SUM(t.amount) AS total, COUNT(*) AS count,
              SUM(t.amount) FILTER (WHERE date_trunc('month', t.date) = date_trunc('month', current_date)) AS month_total,
              (array_agg(t.date ORDER BY t.date DESC, t.id DESC))[1] AS last_date,
              (array_agg(t.amount ORDER BY t.date DESC, t.id DESC))[1] AS last_amount,
              (array_agg(t.account_id ORDER BY t.date DESC, t.id DESC))[1] AS last_account_id
       FROM transactions t WHERE t.recipient_id = r.id
     ) s ON true
     ORDER BY r.is_favorite DESC, s.last_date DESC NULLS LAST, r.name`,
  ));
});

function recipientValues(body) {
  required(body, ['name']);
  const relation = RELATIONS.includes(body.relation) ? body.relation : 'other';
  const method = METHODS.includes(body.method) ? body.method : 'bank';
  const clean = (value) => (typeof value === 'string' && value.trim()) || null;
  return [
    body.name.trim(), relation, method, clean(body.provider),
    method === 'cash' ? null : clean(body.account_number)?.replace(/[^\d]/g, '') || null,
    method === 'cash' ? null : clean(body.holder_name),
    Number(body.category_id) || null, clean(body.note),
  ];
}

router.post('/', async (req, res) => {
  const [recipient] = await query(
    `INSERT INTO recipients (name, relation, method, provider, account_number, holder_name, category_id, note, is_favorite)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [...recipientValues(req.body), Boolean(req.body.is_favorite)],
  );
  res.status(201).json(recipient);
});

router.put('/:id', async (req, res) => {
  const [recipient] = await query(
    `UPDATE recipients SET name = $1, relation = $2, method = $3, provider = $4, account_number = $5,
            holder_name = $6, category_id = $7, note = $8
     WHERE id = $9 RETURNING *`,
    [...recipientValues(req.body), req.params.id],
  );
  if (!recipient) throw new HttpError(404, 'Penerima tidak ditemukan');
  res.json(recipient);
});

router.put('/:id/favorite', async (req, res) => {
  const [recipient] = await query(
    'UPDATE recipients SET is_favorite = NOT is_favorite WHERE id = $1 RETURNING *',
    [req.params.id],
  );
  if (!recipient) throw new HttpError(404, 'Penerima tidak ditemukan');
  res.json(recipient);
});

// Hapus penerima: riwayat kirimannya tetap ada sebagai pengeluaran biasa.
router.delete('/:id', async (req, res) => {
  await query('DELETE FROM recipients WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

router.get('/:id/history', async (req, res) => {
  res.json(await query(
    `SELECT t.id, t.date, t.amount, t.note, a.name AS account_name,
            (SELECT f.amount FROM transactions f WHERE f.fee_of = t.id) AS fee
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.recipient_id = $1
     ORDER BY t.date DESC, t.id DESC`,
    [req.params.id],
  ));
});

export default router;
