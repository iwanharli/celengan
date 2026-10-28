import { Router } from 'express';
import { pool, query, withTransaction, required, HttpError } from '../db.js';

const router = Router();

// Saat utang lunas, tagihan cicilannya otomatis dimatikan.
export async function closeDebtBillsIfPaid(client, debtId) {
  await client.query(
    `UPDATE bills SET active = false
     WHERE debt_id = $1 AND (SELECT remaining FROM debt_status WHERE id = $1) <= 0`,
    [debtId],
  );
}

// ---------- Jadwal cicilan ----------

const todayISO = () => new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD' waktu lokal

// Pembayaran (urut tanggal) dialokasikan ke cicilan paling awal dulu.
// Hasil per cicilan: status 'paid' | 'overdue' | 'upcoming', tanggal lunas, dan kekurangannya.
function withPaymentStatus(installments, payments) {
  const today = todayISO();
  let totalDue = 0;
  let totalPaid = 0;
  let nextPayment = 0;

  return installments.map((installment) => {
    totalDue += installment.amount;
    while (totalPaid < totalDue && nextPayment < payments.length) {
      totalPaid += payments[nextPayment].amount;
      nextPayment += 1;
    }
    const isPaid = totalPaid >= totalDue;
    return {
      ...installment,
      status: isPaid ? 'paid' : installment.due_date < today ? 'overdue' : 'upcoming',
      paid_on: isPaid ? payments[nextPayment - 1].date : null,
      outstanding: isPaid ? 0 : Math.min(installment.amount, totalDue - totalPaid),
    };
  });
}

const PAYMENTS_SQL = `
  SELECT t.debt_id, t.amount, t.date
  FROM transactions t
  JOIN debts d ON d.id = t.debt_id
  WHERE ((d.direction = 'payable' AND t.kind IN ('debt_out', 'expense'))
      OR (d.direction = 'receivable' AND t.kind IN ('debt_in', 'income')))`;

async function loadSchedules(db, debtIds) {
  const [installments, payments] = await Promise.all([
    db.query('SELECT * FROM debt_installments WHERE debt_id = ANY($1) ORDER BY debt_id, number', [debtIds]),
    db.query(`${PAYMENTS_SQL} AND t.debt_id = ANY($1) ORDER BY t.date, t.id`, [debtIds]),
  ]);
  return Object.fromEntries(debtIds.map((id) => [
    id,
    withPaymentStatus(
      installments.rows.filter((row) => row.debt_id === id),
      payments.rows.filter((row) => row.debt_id === id),
    ),
  ]));
}

// Menentukan total & cicilan dari isian yang tersedia (logika yang sama dipakai di form).
function resolveTerms({ principal, total_amount, installment, tenor }) {
  const months = Number(tenor) || null;
  let perMonth = Number(installment) || null;
  let total = Number(total_amount) || null;
  if (!total) total = perMonth && months ? perMonth * months : Number(principal);
  if (!perMonth && months) perMonth = Math.ceil(total / months);
  return { total, installment: perMonth, tenor: months };
}

// Membuat ulang jadwal: tiap bulan sebesar `installment`, cicilan terakhir menyesuaikan sisa total.
async function createSchedule(client, debtId, { total, installment, tenor }, firstDue) {
  const lastAmount = total - installment * (tenor - 1);
  if (lastAmount <= 0) throw new HttpError(400, 'Cicilan per bulan terlalu besar untuk tenor ini');

  await client.query('DELETE FROM debt_installments WHERE debt_id = $1', [debtId]);
  await client.query(
    `INSERT INTO debt_installments (debt_id, number, due_date, amount)
     SELECT $1, n, ($2::date + (n - 1) * interval '1 month')::date,
            CASE WHEN n = $3 THEN $5::bigint ELSE $4::bigint END
     FROM generate_series(1, $3::int) AS n`,
    [debtId, firstDue, tenor, installment, lastAmount],
  );
}

// Tagihan bulanan untuk utang bercicilan: jatuh tempo = cicilan berikutnya yang belum lunas.
async function syncInstallmentBill(client, debt, accountId) {
  if (debt.direction !== 'payable' || !debt.installment) return;
  const schedule = (await loadSchedules(client, [debt.id]))[debt.id];
  const next = schedule.find((installment) => installment.status !== 'paid');
  if (!next) return;

  const { rowCount } = await client.query(
    'UPDATE bills SET amount = $1, next_due = $2, active = true WHERE debt_id = $3',
    [debt.installment, next.due_date, debt.id],
  );
  if (rowCount === 0) {
    await client.query(
      `INSERT INTO bills (name, amount, frequency, next_due, account_id, debt_id)
       VALUES ($1, $2, 'monthly', $3, $4, $5)`,
      [`Cicilan ${debt.counterparty}`, debt.installment, next.due_date, accountId || null, debt.id],
    );
  }
}

// Dipanggil setelah setiap pembayaran utang (dari halaman Utang maupun Tagihan).
// Mengembalikan true jika tagihannya sudah diurus (jadwal bertenor), false jika belum.
export async function afterDebtPayment(client, debtId) {
  const { rows: [debt] } = await client.query('SELECT * FROM debts WHERE id = $1', [debtId]);
  if (debt.tenor) await syncInstallmentBill(client, debt);
  await closeDebtBillsIfPaid(client, debtId);
  return Boolean(debt.tenor);
}

// Kategori pengeluaran "Bayar utang" (dibuat otomatis bila belum ada).
export async function debtCategoryId(client) {
  const { rows: [existing] } = await client.query(
    `SELECT id FROM categories WHERE kind = 'expense' AND name = 'Bayar utang' LIMIT 1`,
  );
  if (existing) return existing.id;
  const { rows: [created] } = await client.query(
    `INSERT INTO categories (name, kind, icon, color) VALUES ('Bayar utang', 'expense', 'hand-coins', '#f97316') RETURNING id`,
  );
  return created.id;
}

// Jenis & kategori transaksi pembayaran utang (dipakai di sini & saat bayar tagihan cicilan).
export async function debtPaymentKind(client, debt) {
  if (debt.direction === 'payable' && debt.count_as_expense) return { kind: 'expense', categoryId: await debtCategoryId(client) };
  return { kind: debt.direction === 'payable' ? 'debt_out' : 'debt_in', categoryId: null };
}

// ---------- Endpoint ----------

router.get('/', async (req, res) => {
  const debts = await query(
    `SELECT ds.*, (SELECT count(*)::int FROM transactions t WHERE t.debt_id = ds.id) AS transaction_count
     FROM debt_status ds ORDER BY ds.remaining <= 0, ds.due_date NULLS LAST, ds.id`,
  );
  const schedules = await loadSchedules(pool, debts.map((debt) => debt.id));
  res.json(debts.map((debt) => ({ ...debt, installments: schedules[debt.id] })));
});

// Mencatat utang/piutang baru.
// - account_id (opsional): uang benar-benar masuk/keluar dari akun -> transaksi debt_in/debt_out
// - tenor + first_due (opsional): dibuatkan jadwal cicilan; untuk utang juga tagihan bulanan
router.post('/', async (req, res) => {
  required(req.body, ['direction', 'type', 'counterparty', 'principal']);
  const { direction, type, counterparty, principal, due_date, note, account_id, first_due } = req.body;
  const terms = resolveTerms(req.body);
  if (type === 'invoice' && direction !== 'receivable') throw new HttpError(400, 'Invoice hanya untuk piutang ke klien');
  if (terms.tenor && !first_due) throw new HttpError(400, 'Isi tanggal cicilan pertama');

  const debt = await withTransaction(async (client) => {
    const { rows: [debt] } = await client.query(
      `INSERT INTO debts (direction, type, counterparty, principal, total_amount, installment, tenor, due_date, note, count_as_expense)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [direction, type, counterparty, principal, terms.total, terms.installment, terms.tenor, due_date || null, note || null,
        // Bawaan: utang yang dicatat tanpa uang masuk → pembayarannya dihitung pengeluaran.
        direction === 'payable' && (req.body.count_as_expense ?? !account_id) === true],
    );

    // Invoice klien belum ada uang yang berpindah; uang baru masuk saat klien membayar.
    if (account_id && type !== 'invoice') {
      const isBorrowing = direction === 'payable';
      await client.query(
        `INSERT INTO transactions (kind, amount, account_id, debt_id, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          isBorrowing ? 'debt_in' : 'debt_out',
          principal,
          account_id,
          debt.id,
          isBorrowing ? `Pinjaman dari ${counterparty}` : `Dipinjam ${counterparty}`,
        ],
      );
    }

    if (terms.tenor) {
      await createSchedule(client, debt.id, terms, first_due);
      await syncInstallmentBill(client, debt, account_id);
    } else if (direction === 'payable' && terms.installment && first_due) {
      // Cicilan tanpa tenor: cukup tagihan bulanan seperti sebelumnya.
      await client.query(
        `INSERT INTO bills (name, amount, frequency, next_due, account_id, debt_id)
         VALUES ($1, $2, 'monthly', $3, $4, $5)`,
        [`Cicilan ${counterparty}`, terms.installment, first_due, account_id || null, debt.id],
      );
    }
    return debt;
  });
  res.status(201).json(debt);
});

// Edit detail utang/piutang. Arah (utang/piutang) tidak bisa diubah.
// Jika total berubah dan ada jadwal cicilan, jadwalnya dihitung ulang dengan tenor & tanggal yang sama.
router.put('/:id', async (req, res) => {
  required(req.body, ['counterparty', 'type', 'principal']);
  const { counterparty, type, principal, due_date, note } = req.body;
  const total = Number(req.body.total_amount) || Number(principal);

  await withTransaction(async (client) => {
    const { rows: [debt] } = await client.query('SELECT * FROM debts WHERE id = $1', [req.params.id]);
    if (!debt) throw new HttpError(404, 'Utang tidak ditemukan');
    if ((type === 'invoice') !== (debt.type === 'invoice')) {
      throw new HttpError(400, 'Jenis invoice tidak bisa diubah menjadi jenis lain (atau sebaliknya)');
    }

    const countAsExpense = debt.direction === 'payable' && (req.body.count_as_expense ?? debt.count_as_expense) === true;
    const { rows: [updated] } = await client.query(
      `UPDATE debts SET counterparty = $1, type = $2, principal = $3, total_amount = $4, due_date = $5, note = $6, count_as_expense = $7
       WHERE id = $8 RETURNING *`,
      [counterparty, type, principal, total, due_date || null, note || null, countAsExpense, debt.id],
    );
    // Opsi diubah → pembayaran yang sudah ada ikut dikonversi (debt_out ↔ expense).
    if (countAsExpense !== debt.count_as_expense) {
      if (countAsExpense) {
        await client.query(
          `UPDATE transactions SET kind = 'expense', category_id = $1 WHERE debt_id = $2 AND kind = 'debt_out'`,
          [await debtCategoryId(client), debt.id],
        );
      } else {
        await client.query(
          `UPDATE transactions SET kind = 'debt_out', category_id = NULL WHERE debt_id = $1 AND kind = 'expense'`, [debt.id],
        );
      }
    }

    if (debt.tenor && total !== debt.total_amount) {
      const { rows: [first] } = await client.query(
        'SELECT due_date FROM debt_installments WHERE debt_id = $1 ORDER BY number LIMIT 1', [debt.id],
      );
      const terms = resolveTerms({ total_amount: total, tenor: debt.tenor });
      await client.query('UPDATE debts SET installment = $1 WHERE id = $2', [terms.installment, debt.id]);
      await createSchedule(client, debt.id, terms, first.due_date);
      await syncInstallmentBill(client, { ...updated, installment: terms.installment });
    }
    await client.query(
      `UPDATE bills SET name = $1 WHERE debt_id = $2`, [`Cicilan ${counterparty}`, debt.id],
    );
    if (debt.type === 'invoice') {
      await client.query(`UPDATE transactions SET client = $1 WHERE debt_id = $2 AND kind = 'income'`, [counterparty, debt.id]);
    }
    await closeDebtBillsIfPaid(client, debt.id);
  });
  res.status(204).end();
});

// Mengatur (ulang) jadwal cicilan untuk utang yang sudah tercatat.
// Pembayaran lama otomatis menandai cicilan paling awal sebagai lunas.
router.put('/:id/schedule', async (req, res) => {
  required(req.body, ['tenor', 'first_due']);
  await withTransaction(async (client) => {
    const { rows: [debt] } = await client.query('SELECT * FROM debts WHERE id = $1', [req.params.id]);
    if (!debt) throw new HttpError(404, 'Utang tidak ditemukan');

    const terms = resolveTerms({ ...req.body, total_amount: debt.total_amount });
    const { rows: [updated] } = await client.query(
      'UPDATE debts SET tenor = $1, installment = $2 WHERE id = $3 RETURNING *',
      [terms.tenor, terms.installment, debt.id],
    );
    await createSchedule(client, debt.id, terms, req.body.first_due);
    await syncInstallmentBill(client, updated);
  });
  res.status(204).end();
});

// Kategori pemasukan untuk pembayaran invoice; dibuat otomatis bila belum ada.
async function freelanceCategoryId(client) {
  const { rows: [existing] } = await client.query(
    "SELECT id FROM categories WHERE kind = 'income' AND name = 'Freelance' LIMIT 1",
  );
  if (existing) return existing.id;
  const { rows: [created] } = await client.query(
    `INSERT INTO categories (name, kind, icon, color) VALUES ('Freelance', 'income', 'laptop', '#0ea5e9') RETURNING id`,
  );
  return created.id;
}

// Bayar utang (uang keluar) atau terima pembayaran piutang (uang masuk).
// Pembayaran invoice klien dicatat sebagai pemasukan, bukan sekadar piutang kembali.
router.post('/:id/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);
  await withTransaction(async (client) => {
    const { rows: [debt] } = await client.query('SELECT * FROM debts WHERE id = $1', [req.params.id]);
    if (!debt) throw new HttpError(404, 'Utang tidak ditemukan');

    const isPayable = debt.direction === 'payable';
    const isInvoice = debt.type === 'invoice';
    const payment = await debtPaymentKind(client, debt);
    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, debt_id, date, note, client)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        isInvoice ? 'income' : payment.kind,
        req.body.amount,
        req.body.account_id,
        isInvoice ? await freelanceCategoryId(client) : payment.categoryId,
        debt.id,
        req.body.date,
        isInvoice
          ? `Invoice ${debt.counterparty}${debt.note ? ` · ${debt.note}` : ''}`
          : isPayable ? `Bayar ${debt.counterparty}` : `Diterima dari ${debt.counterparty}`,
        isInvoice ? debt.counterparty : null,
      ],
    );
    // Tagihan cicilannya ikut maju ke cicilan berikutnya yang belum lunas.
    await afterDebtPayment(client, debt.id);
  });
  res.status(204).end();
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM debts WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

export default router;
