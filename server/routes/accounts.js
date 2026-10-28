import { Router } from 'express';
import { query, required, HttpError } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  // transaction_count: dipakai modal hapus untuk menjelaskan berapa transaksi yang ikut terhapus.
  res.json(await query(
    `SELECT ab.*, (SELECT count(*)::int FROM transactions t
                   WHERE t.account_id = ab.id OR t.to_account_id = ab.id) AS transaction_count
     FROM account_balances ab ORDER BY ab.id`,
  ));
});

// Nomor rekening / HP disimpan sebagai angka saja ("123-456 789" → "123456789").
// Bank: 5–20 digit. E-wallet: nomor HP 9–15 digit. Tunai: tidak punya nomor.
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

  const clean = (value) => String(value ?? '').trim() || null;
  return [
    name.trim(), type, initial_balance,
    clean(provider), type === 'cash' ? null : number || null, type === 'cash' ? null : clean(holder_name), clean(note),
  ];
}

router.post('/', async (req, res) => {
  const [account] = await query(
    `INSERT INTO accounts (name, type, initial_balance, provider, account_number, holder_name, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    accountValues(req.body),
  );
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
  if (difference !== 0) {
    await query(
      `INSERT INTO transactions (kind, amount, account_id, note)
       VALUES ('adjustment', $1, $2, 'Penyesuaian saldo')`,
      [difference, req.params.id],
    );
  }
  res.json({ difference });
});

export default router;
