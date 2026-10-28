import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { afterDebtPayment, debtPaymentKind } from './debts.js';

const router = Router();

router.get('/', async (req, res) => {
  await runAutoPay();
  res.json(await query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name, d.counterparty AS debt_name,
            (b.auto_pay AND b.next_due <= current_date AND ab.balance < b.amount) AS auto_pay_blocked
     FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     LEFT JOIN accounts a   ON a.id = b.account_id
     LEFT JOIN account_balances ab ON ab.id = b.account_id
     LEFT JOIN debts d      ON d.id = b.debt_id
     WHERE b.active
     ORDER BY b.next_due`,
  ));
});

router.post('/', async (req, res) => {
  required(req.body, ['name', 'amount', 'frequency', 'next_due']);
  const { name, amount, frequency, next_due, category_id, account_id } = req.body;
  const [bill] = await query(
    `INSERT INTO bills (name, amount, frequency, next_due, category_id, account_id, auto_pay)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name, amount, frequency, next_due, category_id || null, account_id || null, Boolean(account_id && req.body.auto_pay)],
  );
  res.status(201).json(bill);
});

// Edit tagihan. Tanggal jatuh tempo yang baru menjadi patokan tanggal tiap periode (due_day).
// Tagihan cicilan utang: frekuensi tetap bulanan dan kategori tidak dipakai.
router.put('/:id', async (req, res) => {
  required(req.body, ['name', 'amount', 'frequency', 'next_due']);
  const { name, amount, frequency, next_due, category_id, account_id } = req.body;
  const [bill] = await query(
    `UPDATE bills
     SET name = $1, amount = $2,
         frequency = CASE WHEN debt_id IS NULL THEN $3 ELSE 'monthly' END,
         next_due = $4, due_day = extract(day FROM $4::date),
         category_id = CASE WHEN debt_id IS NULL THEN $5::int END,
         account_id = $6, auto_pay = $8
     WHERE id = $7 AND active
     RETURNING *`,
    [name, amount, frequency, next_due, category_id || null, account_id || null, req.params.id, Boolean(account_id && req.body.auto_pay)],
  );
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  res.json(bill);
});

// Tagihan yang sudah berhenti, terbaru dulu, beserta total yang pernah dibayar.
router.get('/ended', async (req, res) => {
  res.json(await query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name,
            COALESCE(p.total, 0)::bigint AS total_paid, COALESCE(p.count, 0)::int AS paid_count
     FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     LEFT JOIN accounts a   ON a.id = b.account_id
     LEFT JOIN (SELECT bill_id, SUM(amount) AS total, COUNT(*) AS count FROM transactions GROUP BY bill_id) p ON p.bill_id = b.id
     WHERE NOT b.active AND b.debt_id IS NULL
     ORDER BY b.ended_at DESC NULLS LAST, b.id DESC`,
  ));
});

// Berhenti langganan: pengingat & potong otomatis berhenti, riwayat tetap ada.
router.post('/:id/stop', async (req, res) => {
  const [bill] = await query(
    `UPDATE bills SET active = false, ended_at = COALESCE($2::date, current_date)
     WHERE id = $1 AND active AND debt_id IS NULL RETURNING *`,
    [req.params.id, req.body?.date || null],
  );
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  res.json(bill);
});

// Aktifkan lagi: jatuh tempo dimajukan sampai hari ini atau sesudahnya (periode selama berhenti tidak ditagih).
router.post('/:id/resume', async (req, res) => {
  const bill = await withTransaction(async (client) => {
    const { rows: [bill] } = await client.query(
      `UPDATE bills SET active = true, ended_at = NULL WHERE id = $1 AND NOT active AND debt_id IS NULL RETURNING *`,
      [req.params.id],
    );
    if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
    const { rows: [updated] } = await client.query(
      `WITH RECURSIVE due(d, n) AS (
         SELECT next_due, 0 FROM bills WHERE id = $1
         UNION ALL
         SELECT next_due_date(d, b.frequency, b.due_day), n + 1 FROM due, bills b
         WHERE b.id = $1 AND d < current_date AND n < 1000
       )
       UPDATE bills SET next_due = (SELECT d FROM due WHERE d >= current_date ORDER BY d LIMIT 1)
       WHERE id = $1 AND next_due < current_date RETURNING *`,
      [bill.id],
    );
    return updated ?? bill;
  });
  res.json(bill);
});

// Hapus permanen (misal salah input). Transaksi pembayarannya tetap ada, hanya tidak terhubung lagi.
router.delete('/:id', async (req, res) => {
  const [bill] = await query('DELETE FROM bills WHERE id = $1 AND debt_id IS NULL RETURNING id', [req.params.id]);
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  res.status(204).end();
});

// Maju satu periode dengan tetap memakai tanggal aslinya (lihat next_due_date di schema.sql).
async function advanceDueDate(client, bill) {
  await client.query(
    'UPDATE bills SET next_due = next_due_date(next_due, frequency, due_day) WHERE id = $1',
    [bill.id],
  );
}

async function findBill(client, id) {
  const { rows: [bill] } = await client.query('SELECT * FROM bills WHERE id = $1 AND active', [id]);
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  return bill;
}

// Bayar: catat transaksi (nominal bisa diubah, misal listrik), lalu majukan jatuh tempo.
// Jika tagihan ini cicilan utang, transaksinya "debt_out" sehingga mengurangi sisa utang.
async function payBill(client, bill, { amount, account_id, date, note = bill.name }) {
  // Cicilan utang: jenisnya mengikuti opsi "hitung sebagai pengeluaran" di utang itu.
  let payment = { kind: 'expense', categoryId: bill.category_id };
  if (bill.debt_id) {
    const { rows: [debt] } = await client.query('SELECT * FROM debts WHERE id = $1', [bill.debt_id]);
    payment = await debtPaymentKind(client, debt);
  }
  await client.query(
    `INSERT INTO transactions (kind, amount, account_id, category_id, debt_id, bill_id, date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [payment.kind, amount, account_id, payment.categoryId, bill.debt_id, bill.id, date, note],
  );
  // Cicilan bertenor: jatuh tempo mengikuti jadwal cicilan. Selain itu: maju satu periode.
  const handledBySchedule = bill.debt_id && (await afterDebtPayment(client, bill.debt_id));
  if (!handledBySchedule) await advanceDueDate(client, bill);
}

router.post('/:id/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);
  await withTransaction(async (client) => {
    const bill = await findBill(client, req.params.id);
    await payBill(client, bill, req.body);
  });
  res.status(204).end();
});

// Riwayat satu tagihan: pembayaran (manual / potong otomatis) dan periode yang dilewati, terbaru dulu.
router.get('/:id/history', async (req, res) => {
  const payments = await query(
    `SELECT t.id, 'paid' AS type, t.date, t.amount, t.note, a.name AS account_name,
            t.note LIKE '%(potong otomatis)' AS auto
     FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.bill_id = $1`,
    [req.params.id],
  );
  const skips = await query(
    `SELECT id, 'skipped' AS type, due_date AS date FROM bill_skips WHERE bill_id = $1`,
    [req.params.id],
  );
  const year = String(new Date().getFullYear());
  const thisYear = payments.filter((payment) => payment.date.startsWith(year));
  res.json({
    events: [...payments, ...skips].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    stats: {
      count: payments.length,
      total: payments.reduce((sum, payment) => sum + payment.amount, 0),
      yearTotal: thisYear.reduce((sum, payment) => sum + payment.amount, 0),
      average: payments.length ? Math.round(payments.reduce((sum, p) => sum + p.amount, 0) / payments.length) : 0,
      min: payments.length ? Math.min(...payments.map((p) => p.amount)) : 0,
      max: payments.length ? Math.max(...payments.map((p) => p.amount)) : 0,
      skipped: skips.length,
    },
  });
});

// Potong otomatis: tagihan auto_pay yang sudah jatuh tempo dibayar dari akunnya, bertanggal jatuh tempo.
// Kalau saldo akun tidak cukup, tagihan dibiarkan (tampil "saldo kurang") dan dicoba lagi nanti.
// Tagihan yang terlewat beberapa periode dibayar satu per satu selama saldonya cukup.
// Dipanggil saat data tagihan / ringkasan dimuat, jadi tidak butuh penjadwal terpisah.
export async function runAutoPay() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4242)'); // cegah dua permintaan membayar bersamaan
    for (let round = 0; round < 60; round += 1) {
      const { rows: [bill] } = await client.query(
        `SELECT b.* FROM bills b JOIN account_balances ab ON ab.id = b.account_id
         WHERE b.active AND b.auto_pay AND b.next_due <= current_date AND ab.balance >= b.amount
         ORDER BY b.next_due, b.id LIMIT 1`,
      );
      if (!bill) return;
      await payBill(client, bill, {
        amount: bill.amount,
        account_id: bill.account_id,
        date: bill.next_due,
        note: `${bill.name} (potong otomatis)`,
      });
    }
  });
}

router.post('/:id/skip', async (req, res) => {
  await withTransaction(async (client) => {
    const bill = await findBill(client, req.params.id);
    await client.query('INSERT INTO bill_skips (bill_id, due_date) VALUES ($1, $2)', [bill.id, bill.next_due]);
    await advanceDueDate(client, bill);
  });
  res.status(204).end();
});

export default router;
