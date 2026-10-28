import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  // transaction_count: dipakai modal hapus untuk menjelaskan berapa transaksi yang ikut terhapus.
  res.json(await query(
    `SELECT ab.*, (SELECT count(*)::int FROM transactions t
                   WHERE t.account_id = ab.id OR t.to_account_id = ab.id) AS transaction_count
     FROM account_balances ab ORDER BY ab.is_primary DESC, ab.id`,
  ));
});

// Nomor rekening / HP disimpan sebagai angka saja ("123-456 789" → "123456789").
// Bank: 5–20 digit. E-wallet: nomor HP 9–15 digit. E-money: nomor kartu 16 digit. Tunai: tidak punya nomor.
function accountValues(body) {
  required(body, ['name', 'type']);
  const { name, type, initial_balance = 0, provider, holder_name, note } = body;
  const number = String(body.account_number ?? '').replace(/\D/g, '');

  if (number && type === 'bank' && (number.length < 5 || number.length > 20)) {
    throw new HttpError(400, 'Nomor rekening harus 5–20 angka');
  }
  if (number && type === 'ewallet' && (number.length < 9 || number.length > 15)) {
    throw new HttpError(400, 'Nomor HP e-wallet harus 9–15 angka');
  }
  if (number && type === 'emoney' && number.length !== 16) {
    throw new HttpError(400, 'Nomor kartu e-money harus 16 angka');
  }

  const clean = (value) => String(value ?? '').trim() || null;
  return [
    name.trim(), type, initial_balance,
    clean(provider), type === 'cash' ? null : number || null, ['cash', 'emoney'].includes(type) ? null : clean(holder_name), clean(note),
  ];
}

// income (opsional): { category_id, date } → saldo awal dicatat sebagai PEMASUKAN, bukan saldo awal.
// Akun dibuat dengan saldo awal 0, lalu dibuatkan transaksi pemasukan sebesar nominalnya.
router.post('/', async (req, res) => {
  const values = accountValues(req.body);
  const income = req.body.income;
  const amount = Number(values[2]);
  if (income && !(amount > 0)) throw new HttpError(400, 'Isi nominal saldo awal untuk dicatat sebagai pemasukan');
  if (income && !income.category_id) throw new HttpError(400, 'Pilih kategori pemasukan');

  const account = await withTransaction(async (client) => {
    if (income) values[2] = 0;
    const { rows: [account] } = await client.query(
      `INSERT INTO accounts (name, type, initial_balance, provider, account_number, holder_name, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      values,
    );
    if (income) {
      await client.query(
        `INSERT INTO transactions (kind, amount, account_id, category_id, date, note)
         VALUES ('income', $1, $2, $3, COALESCE($4::date, current_date), $5)`,
        [amount, account.id, income.category_id, income.date || null, `Saldo awal ${account.name}`],
      );
    }
    return account;
  });
  res.status(201).json(account);
});

// Saldo awal ikut bisa diubah; saldo sekarang = saldo awal + semua transaksi.
router.put('/:id', async (req, res) => {
  required(req.body, ['initial_balance']);
  const [account] = await query(
    `UPDATE accounts
     SET name = $1, type = $2, initial_balance = $3, provider = $4, account_number = $5, holder_name = $6, note = $7
     WHERE id = $8 RETURNING *`,
    [...accountValues(req.body), req.params.id],
  );
  if (!account) throw new HttpError(404, 'Akun tidak ditemukan');
  res.json(account);
});

// Jadikan akun utama (sekaligus melepas tanda dari akun lain). primary: false = lepas tanda.
router.put('/:id/primary', async (req, res) => {
  const primary = req.body.primary !== false;
  await withTransaction(async (client) => {
    if (primary) await client.query('UPDATE accounts SET is_primary = false WHERE is_primary');
    const { rowCount } = await client.query('UPDATE accounts SET is_primary = $1 WHERE id = $2', [primary, req.params.id]);
    if (!rowCount) throw new HttpError(404, 'Akun tidak ditemukan');
  });
  res.status(204).end();
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

// Sesuaikan saldo: user memasukkan saldo asli, selisihnya dicatat sebagai transaksi penyesuaian.
router.post('/:id/adjust', async (req, res) => {
  required(req.body, ['actual_balance']);
  const [account] = await query('SELECT balance FROM account_balances WHERE id = $1', [req.params.id]);
  if (!account) throw new HttpError(404, 'Akun tidak ditemukan');

  const difference = Number(req.body.actual_balance) - account.balance;
  // record_as 'flow': selisih dicatat sebagai pemasukan (lebih) / pengeluaran (kurang) dengan kategori pilihan,
  // supaya ikut terhitung di laporan. Bawaan: penyesuaian biasa (tidak dihitung pemasukan/pengeluaran).
  if (difference !== 0 && req.body.record_as === 'flow') {
    if (!req.body.category_id) throw new HttpError(400, 'Pilih kategori untuk selisihnya');
    await query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note)
       VALUES ($1, $2, $3, $4, current_date, $5)`,
      [difference > 0 ? 'income' : 'expense', Math.abs(difference), req.params.id, req.body.category_id,
        req.body.note || 'Selisih saldo'],
    );
  } else if (difference !== 0) {
    await query(
      `INSERT INTO transactions (kind, amount, account_id, note)
       VALUES ('adjustment', $1, $2, 'Penyesuaian saldo')`,
      [difference, req.params.id],
    );
  }
  res.json({ difference });
});

export default router;
