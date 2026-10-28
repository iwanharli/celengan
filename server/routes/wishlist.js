import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';

// Wishlist & impian: barang, pernikahan, lamaran, liburan, rumah, dll. (kolom kind)
// Target bisa dirinci (wishlist_parts), dan tiap rincian bisa dibayar bertahap.
// Progres = uang disisihkan (amplop virtual) + yang sudah dibayar lewat rincian.
//
// Status:
//   wanted    → masih diinginkan, bisa disisihkan uangnya
//   bought    → sudah dibeli (tercatat sebagai pengeluaran, transaction_id terisi)
//   cancelled → tidak jadi; uang yang disisihkan dilepas
// Setiap perubahan dicatat di wishlist_events sebagai riwayat.

const router = Router();

const PRIORITY_ORDER = `CASE w.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;

async function logEvent(db, itemId, type, amount = null, note = null) {
  await db.query(
    'INSERT INTO wishlist_events (item_id, type, amount, note) VALUES ($1, $2, $3, $4)',
    [itemId, type, amount, note],
  );
}

async function findItem(client, id, status) {
  const { rows: [item] } = await client.query('SELECT * FROM wishlist_items WHERE id = $1', [id]);
  if (!item) throw new HttpError(404, 'Wishlist tidak ditemukan');
  if (status && item.status !== status) {
    throw new HttpError(400, 'Status barang ini sudah berubah. Muat ulang halaman.');
  }
  return item;
}

// Dipakai juga saat transaksi pembelian dihapus dari halaman Transaksi.
export async function revertWishlistPurchase(client, transactionId, note) {
  const { rows: [item] } = await client.query(
    `UPDATE wishlist_items SET status = 'wanted', bought_at = NULL, transaction_id = NULL
     WHERE transaction_id = $1 RETURNING *`,
    [transactionId],
  );
  if (item) await logEvent(client, item.id, 'purchase_cancelled', null, note);
}

router.get('/', async (req, res) => {
  res.json(await query(
    `SELECT w.*, t.amount AS paid_amount, c.name AS category_name, a.name AS account_name,
            COALESCE((
              SELECT json_agg(p ORDER BY p.position, p.id) FROM (
                SELECT wp.*, COALESCE((SELECT SUM(pt.amount) FROM transactions pt
                                       WHERE pt.wish_part_id = wp.id AND pt.kind = 'expense'), 0)::bigint AS paid
                FROM wishlist_parts wp WHERE wp.item_id = w.id
              ) AS p
            ), '[]') AS parts,
            COALESCE((
              SELECT json_agg(e ORDER BY e.created_at DESC, e.id DESC)
              FROM wishlist_events e WHERE e.item_id = w.id
            ), '[]') AS events
     FROM wishlist_items w
     LEFT JOIN transactions t ON t.id = w.transaction_id
     LEFT JOIN categories c   ON c.id = t.category_id
     LEFT JOIN accounts a     ON a.id = t.account_id
     ORDER BY ${PRIORITY_ORDER}, w.created_at`,
  ).then((items) => items.map((item) => ({
    ...item,
    paid_total: item.parts.reduce((sum, part) => sum + part.paid, 0),
  }))));
});

// Simpan rincian biaya: yang punya id diperbarui, yang baru ditambahkan, yang hilang dihapus.
// Rincian yang sudah ada pembayarannya tidak boleh dihapus (riwayat pembayaran tetap utuh).
// parts undefined = rincian tidak diubah.
async function saveParts(client, itemId, parts) {
  if (!Array.isArray(parts)) return;
  const clean = parts
    .map((part, index) => ({
      id: Number(part.id) || null,
      name: String(part.name ?? '').trim(),
      amount: Math.max(0, Number(part.amount) || 0),
      note: String(part.note ?? '').trim() || null,
      position: index,
    }))
    .filter((part) => part.name);

  const { rows: existing } = await client.query(
    `SELECT wp.id, wp.name, (SELECT count(*)::int FROM transactions t WHERE t.wish_part_id = wp.id) AS payments
     FROM wishlist_parts wp WHERE wp.item_id = $1`,
    [itemId],
  );
  const kept = new Set(clean.map((part) => part.id).filter(Boolean));
  for (const old of existing.filter((part) => !kept.has(part.id))) {
    if (old.payments) throw new HttpError(400, `Rincian "${old.name}" sudah ada pembayarannya, jadi tidak bisa dihapus`);
    await client.query('DELETE FROM wishlist_parts WHERE id = $1', [old.id]);
  }
  for (const part of clean) {
    if (part.id && existing.some((old) => old.id === part.id)) {
      await client.query(
        'UPDATE wishlist_parts SET name = $1, amount = $2, note = $3, position = $4 WHERE id = $5',
        [part.name, part.amount, part.note, part.position, part.id],
      );
    } else {
      await client.query(
        'INSERT INTO wishlist_parts (item_id, name, amount, note, position) VALUES ($1, $2, $3, $4, $5)',
        [itemId, part.name, part.amount, part.note, part.position],
      );
    }
  }
}

function itemValues(body) {
  required(body, ['name', 'price']);
  const { name, price, priority = 'medium', emoji = '1f381', link, note, target_date, kind = 'item' } = body;
  return [name.trim(), price, priority, emoji, link || null, note || null, target_date || null, kind];
}

router.post('/', async (req, res) => {
  const item = await withTransaction(async (client) => {
    const { rows: [item] } = await client.query(
      `INSERT INTO wishlist_items (name, price, priority, emoji, link, note, target_date, kind)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      itemValues(req.body),
    );
    await saveParts(client, item.id, req.body.parts);
    await logEvent(client, item.id, 'created', item.price);
    return item;
  });
  res.status(201).json(item);
});

router.put('/:id', async (req, res) => {
  await withTransaction(async (client) => {
    const before = await findItem(client, req.params.id);
    const { rows: [item] } = await client.query(
      `UPDATE wishlist_items
       SET name = $1, price = $2, priority = $3, emoji = $4, link = $5, note = $6, target_date = $7, kind = $8
       WHERE id = $9 RETURNING *`,
      [...itemValues(req.body), before.id],
    );
    await saveParts(client, item.id, req.body.parts);
    const priceNote = before.price !== item.price ? 'Harga diubah' : null;
    await logEvent(client, item.id, 'edited', priceNote ? item.price : null, priceNote);
  });
  res.status(204).end();
});

// Menyisihkan (amount positif) atau mengambil kembali (amount negatif) uang untuk barang ini.
router.post('/:id/save', async (req, res) => {
  required(req.body, ['amount']);
  const amount = Number(req.body.amount);
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'wanted');
    if (item.saved + amount < 0) throw new HttpError(400, 'Jumlah yang diambil melebihi yang sudah disisihkan');
    await client.query('UPDATE wishlist_items SET saved = saved + $1 WHERE id = $2', [amount, item.id]);
    await logEvent(client, item.id, amount >= 0 ? 'saved' : 'withdrawn', Math.abs(amount));
  });
  res.status(204).end();
});

// Membeli: catat pengeluaran, lalu tandai sudah terbeli.
router.post('/:id/buy', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'category_id', 'date']);
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'wanted');
    const { rows: [transaction] } = await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note)
       VALUES ('expense', $1, $2, $3, $4, $5) RETURNING id`,
      [req.body.amount, req.body.account_id, req.body.category_id, req.body.date, `Wishlist: ${item.name}`],
    );
    await client.query(
      `UPDATE wishlist_items SET status = 'bought', bought_at = $1, transaction_id = $2 WHERE id = $3`,
      [req.body.date, transaction.id, item.id],
    );
    await logEvent(client, item.id, 'bought', Number(req.body.amount));
  });
  res.status(204).end();
});

// Bayar satu rincian (misal DP gedung): dicatat sebagai pengeluaran yang menunjuk ke rincian itu.
// use_saved = true → uang diambil dari dana yang sudah disisihkan (amplop berkurang, progres tetap).
const rupiah = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);

router.post('/:id/parts/:partId/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'category_id', 'date']);
  const amount = Number(req.body.amount);
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'wanted');
    const { rows: [part] } = await client.query(
      'SELECT * FROM wishlist_parts WHERE id = $1 AND item_id = $2', [req.params.partId, item.id],
    );
    if (!part) throw new HttpError(404, 'Rincian tidak ditemukan');

    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note, wish_part_id)
       VALUES ('expense', $1, $2, $3, $4, $5, $6)`,
      [amount, req.body.account_id, req.body.category_id, req.body.date, `${item.name}: ${part.name}`, part.id],
    );
    const fromSaved = req.body.use_saved ? Math.min(item.saved, amount) : 0;
    if (fromSaved) await client.query('UPDATE wishlist_items SET saved = saved - $1 WHERE id = $2', [fromSaved, item.id]);
    await logEvent(client, item.id, 'part_paid', amount,
      part.name + (fromSaved ? ` · ${rupiah(fromSaved)} dari dana disisihkan` : ''));
  });
  res.status(204).end();
});

// Impian tercapai tanpa transaksi pembelian terakhir (misal pernikahan yang dibayar lewat rincian).
router.post('/:id/complete', async (req, res) => {
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'wanted');
    await client.query(
      `UPDATE wishlist_items SET status = 'bought', bought_at = COALESCE($1::date, current_date) WHERE id = $2`,
      [req.body.date || null, item.id],
    );
    await logEvent(client, item.id, 'completed', null, req.body.note || null);
  });
  res.status(204).end();
});

// Batalkan pembelian: transaksi pengeluarannya dihapus, barang kembali ke "diinginkan".
router.post('/:id/unbuy', async (req, res) => {
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'bought');
    if (item.transaction_id) {
      await revertWishlistPurchase(client, item.transaction_id, req.body.reason || 'Pembelian dibatalkan');
      await client.query('DELETE FROM transactions WHERE id = $1', [item.transaction_id]);
    } else {
      await client.query(
        `UPDATE wishlist_items SET status = 'wanted', bought_at = NULL WHERE id = $1`, [item.id],
      );
      await logEvent(client, item.id, 'purchase_cancelled', null, req.body.reason || 'Pembelian dibatalkan');
    }
  });
  res.status(204).end();
});

// Tidak jadi beli: uang yang disisihkan dilepas (dicatat jumlahnya di riwayat).
router.post('/:id/cancel', async (req, res) => {
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'wanted');
    await client.query(
      `UPDATE wishlist_items SET status = 'cancelled', cancelled_at = current_date, cancel_reason = $1, saved = 0
       WHERE id = $2`,
      [req.body.reason || null, item.id],
    );
    await logEvent(client, item.id, 'cancelled', item.saved || null, req.body.reason || null);
  });
  res.status(204).end();
});

// Ingin lagi: barang yang dibatalkan dikembalikan ke daftar keinginan.
router.post('/:id/restore', async (req, res) => {
  await withTransaction(async (client) => {
    const item = await findItem(client, req.params.id, 'cancelled');
    await client.query(
      `UPDATE wishlist_items SET status = 'wanted', cancelled_at = NULL, cancel_reason = NULL WHERE id = $1`,
      [item.id],
    );
    await logEvent(client, item.id, 'restored');
  });
  res.status(204).end();
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM wishlist_items WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

export default router;
