import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { afterDebtPayment } from './debts.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
            a.name AS account_name, d.counterparty AS debt_name
     FROM bills b
     LEFT JOIN categories c ON c.id = b.category_id
     LEFT JOIN accounts a   ON a.id = b.account_id
     LEFT JOIN debts d      ON d.id = b.debt_id
     WHERE b.active
     ORDER BY b.next_due`,
  ));
});

router.post('/', async (req, res) => {
  required(req.body, ['name', 'amount', 'frequency', 'next_due']);
  const { name, amount, frequency, next_due, category_id, account_id } = req.body;
  const [bill] = await query(
    `INSERT INTO bills (name, amount, frequency, next_due, category_id, account_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, amount, frequency, next_due, category_id || null, account_id || null],
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
         account_id = $6
     WHERE id = $7 AND active
     RETURNING *`,
    [name, amount, frequency, next_due, category_id || null, account_id || null, req.params.id],
  );
  if (!bill) throw new HttpError(404, 'Tagihan tidak ditemukan');
  res.json(bill);
});

router.delete('/:id', async (req, res) => {
  await query('UPDATE bills SET active = false WHERE id = $1', [req.params.id]);
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
router.post('/:id/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);
  await withTransaction(async (client) => {
    const bill = await findBill(client, req.params.id);
    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, debt_id, bill_id, date, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        bill.debt_id ? 'debt_out' : 'expense',
        req.body.amount,
        req.body.account_id,
        bill.debt_id ? null : bill.category_id,
        bill.debt_id,
        bill.id,
        req.body.date,
        bill.name,
      ],
    );
    // Cicilan bertenor: jatuh tempo mengikuti jadwal cicilan. Selain itu: maju satu periode.
    const handledBySchedule = bill.debt_id && (await afterDebtPayment(client, bill.debt_id));
    if (!handledBySchedule) await advanceDueDate(client, bill);
  });
  res.status(204).end();
});

router.post('/:id/skip', async (req, res) => {
  await withTransaction(async (client) => {
    await advanceDueDate(client, await findBill(client, req.params.id));
  });
  res.status(204).end();
});

export default router;
