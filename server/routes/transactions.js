import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { revertWishlistPurchase } from './wishlist.js';
import { afterDebtPayment } from './debts.js';
import { periodFromQuery } from '../period.js';

const router = Router();

router.get('/', async (req, res) => {
  const { start, end } = await periodFromQuery(req.query);
  const params = [start, end];
  const where = ['t.date >= $1', 't.date < $2'];

  if (req.query.kind) {
    params.push(req.query.kind);
    where.push(`t.kind = $${params.length}`);
  }
  if (req.query.account_id) {
    params.push(req.query.account_id);
    where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`);
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(t.note ILIKE $${params.length} OR c.name ILIKE $${params.length} OR t.client ILIKE $${params.length})`);
  }

  const rows = await query(
    `SELECT t.*, ${LINK_SQL} AS linked_to,
            a.name  AS account_name,
            ta.name AS to_account_name,
            c.name  AS category_name, c.icon AS category_icon, c.color AS category_color,
            d.counterparty AS debt_name, s.name AS asset_name,
            COALESCE((SELECT json_agg(json_build_object('id', ta.id, 'name', ta.original_name) ORDER BY ta.id)
                      FROM transaction_attachments ta WHERE ta.transaction_id = t.id), '[]') AS attachments
     FROM transactions t
     JOIN accounts a        ON a.id = t.account_id
     LEFT JOIN accounts ta  ON ta.id = t.to_account_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN debts d      ON d.id = t.debt_id
     LEFT JOIN assets s     ON s.id = t.asset_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.date DESC, t.id DESC`,
    params,
  );
  res.json(rows);
});

// Transaksi biasa (pemasukan, pengeluaran, transfer) yang bisa dibuat & diedit langsung.
// Transaksi utang/aset/penyesuaian dibuat dari halamannya masing-masing.
const EDITABLE_KINDS = ['income', 'expense', 'transfer'];

function validTransactionValues(body) {
  required(body, ['kind', 'amount', 'account_id', 'date']);
  const { kind, amount, account_id, to_account_id, category_id, date, note, client } = body;

  if (!EDITABLE_KINDS.includes(kind)) {
    throw new HttpError(400, 'Jenis transaksi tidak valid');
  }
  if (kind === 'transfer' && (!to_account_id || to_account_id === account_id)) {
    throw new HttpError(400, 'Pilih akun tujuan yang berbeda');
  }
  if (kind !== 'transfer' && !category_id) {
    throw new HttpError(400, 'Pilih kategori');
  }

  return [
    kind,
    amount,
    account_id,
    kind === 'transfer' ? to_account_id : null,
    kind === 'transfer' ? null : category_id,
    date,
    note || null,
    kind === 'income' ? client?.trim() || null : null, // nama klien, hanya untuk pemasukan
  ];
}

// Nama klien yang pernah dicatat (pemasukan & invoice), untuk saran di form.
router.get('/clients', async (req, res) => {
  const rows = await query(
    `SELECT name FROM (
       SELECT client AS name, max(date) AS last_used FROM transactions WHERE client IS NOT NULL GROUP BY client
       UNION ALL
       SELECT counterparty, max(created_at)::date FROM debts WHERE type = 'invoice' GROUP BY counterparty
     ) AS names
     GROUP BY name ORDER BY max(last_used) DESC`,
  );
  res.json(rows.map((row) => row.name));
});

router.post('/', async (req, res) => {
  const [transaction] = await query(
    `INSERT INTO transactions (kind, amount, account_id, to_account_id, category_id, date, note, client)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    validTransactionValues(req.body),
  );
  res.status(201).json(transaction);
});

// Transaksi yang terhubung ke invoice/utang, tagihan, rincian wishlist, atau pembelian wishlist
// tidak boleh diganti jenisnya (misal pemasukan → pengeluaran), karena sisa utang, pajak,
// dan status wishlist dihitung dari jenis transaksi itu.
const LINK_SQL = `CASE
  WHEN t.debt_id IS NOT NULL THEN 'debt'
  WHEN t.bill_id IS NOT NULL THEN 'bill'
  WHEN t.wish_part_id IS NOT NULL THEN 'wish_part'
  WHEN EXISTS (SELECT 1 FROM wishlist_items w WHERE w.transaction_id = t.id) THEN 'wish'
END`;

// ---------- Riwayat perubahan (dicatat trigger di database) ----------

// Transaksi yang baru dihapus (30 terakhir), untuk melihat apa yang hilang.
router.get('/history/deleted', async (req, res) => {
  res.json(await query(
    `SELECT h.id, h.transaction_id, h.snapshot, h.created_at,
            a.name AS account_name, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transaction_history h
     LEFT JOIN accounts a   ON a.id = (h.snapshot ->> 'account_id')::int
     LEFT JOIN categories c ON c.id = (h.snapshot ->> 'category_id')::int
     WHERE h.action = 'deleted'
     ORDER BY h.id DESC LIMIT 30`,
  ));
});

router.get('/:id/history', async (req, res) => {
  res.json(await query(
    'SELECT id, action, changes, snapshot, created_at FROM transaction_history WHERE transaction_id = $1 ORDER BY id DESC',
    [req.params.id],
  ));
});

// Edit transaksi utang/aset/penyesuaian: jenis & keterkaitannya tetap, yang bisa diubah hanya
// nominal, akun, tanggal & catatan. Sisa utang & nilai aset ikut menyesuaikan.
async function updateLinkedTransaction(id, body) {
  required(body, ['amount', 'account_id', 'date']);
  const amount = Number(body.amount);
  await withTransaction(async (client) => {
    const { rows: [old] } = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    if (old.kind === 'adjustment' ? amount === 0 : !(amount > 0)) throw new HttpError(400, 'Nominal tidak valid');
    await client.query(
      'UPDATE transactions SET amount = $1, account_id = $2, date = $3, note = $4 WHERE id = $5',
      [amount, body.account_id, body.date, body.note || null, id],
    );
    // Beli aset menambah nilai aset, jual mengurangi: geser sebesar selisih nominalnya.
    if (old.asset_id && amount !== old.amount) {
      const delta = (amount - old.amount) * (old.kind === 'asset_out' ? 1 : -1);
      await client.query(
        'UPDATE assets SET current_value = GREATEST(current_value + $1, 0), updated_at = now() WHERE id = $2',
        [delta, old.asset_id],
      );
    }
    if (old.debt_id) await afterDebtPayment(client, old.debt_id);
  });
}

router.put('/:id', async (req, res) => {
  const [existing] = await query(`SELECT t.kind, t.debt_id, ${LINK_SQL} AS linked_to FROM transactions t WHERE t.id = $1`, [req.params.id]);
  if (!existing) throw new HttpError(404, 'Transaksi tidak ditemukan');
  // Form ringkas (tanpa jenis/kategori) untuk transaksi utang/aset/penyesuaian.
  if (!EDITABLE_KINDS.includes(existing.kind) || (existing.debt_id && !req.body.kind)) {
    await updateLinkedTransaction(req.params.id, req.body);
    res.json((await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]))[0]);
    return;
  }
  if (existing.linked_to && req.body.kind !== existing.kind) {
    throw new HttpError(400, 'Jenis transaksi ini tidak bisa diubah karena terhubung ke utang, tagihan, atau wishlist');
  }
  const [transaction] = await query(
    `UPDATE transactions
     SET kind = $1, amount = $2, account_id = $3, to_account_id = $4, category_id = $5, date = $6, note = $7, client = $8
     WHERE id = $9 AND kind = ANY($10)
     RETURNING *`,
    [...validTransactionValues(req.body), req.params.id, EDITABLE_KINDS],
  );
  if (!transaction) throw new HttpError(404, 'Transaksi tidak ditemukan atau tidak bisa diedit');
  // Pembayaran invoice (pemasukan berutang id) mengubah sisa invoice.
  if (existing.debt_id) await withTransaction((client) => afterDebtPayment(client, existing.debt_id));
  res.json(transaction);
});

router.delete('/:id', async (req, res) => {
  await withTransaction(async (client) => {
    await revertWishlistPurchase(client, req.params.id, 'Transaksi pembelian dihapus');
    await client.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
  });
  res.status(204).end();
});

export default router;
