import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { getStartDay, currentMonth } from '../period.js';

const router = Router();

// Kekayaan bersih = saldo akun + nilai aset + piutang − utang.
async function netWorthBreakdown() {
  const [row] = await query(
    `SELECT (SELECT COALESCE(SUM(balance), 0) FROM account_balances)::bigint      AS cash,
            (SELECT COALESCE(SUM(current_value), 0) FROM assets)::bigint          AS assets,
            (SELECT COALESCE(SUM(GREATEST(remaining, 0)), 0) FROM debt_status
              WHERE direction = 'receivable')::bigint                             AS receivable,
            (SELECT COALESCE(SUM(GREATEST(remaining, 0)), 0) FROM debt_status
              WHERE direction = 'payable')::bigint                                AS payable`,
  );
  return { ...row, total: row.cash + row.assets + row.receivable - row.payable };
}

router.get('/', async (req, res) => {
  const [assets, netWorth] = await Promise.all([
    query(
      `SELECT s.*, (SELECT count(*)::int FROM transactions t WHERE t.asset_id = s.id) AS transaction_count
       FROM asset_status s ORDER BY s.current_value DESC`,
    ),
    netWorthBreakdown(),
  ]);

  // Simpan snapshot bulan ini supaya grafik pertumbuhan terbentuk dari waktu ke waktu.
  const month = currentMonth(await getStartDay());
  await query(
    `INSERT INTO net_worth_snapshots (month, value) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET value = EXCLUDED.value`,
    [month, netWorth.total],
  );
  const history = await query('SELECT * FROM net_worth_snapshots ORDER BY month DESC LIMIT 12');

  res.json({ assets, netWorth, history: history.reverse() });
});

router.post('/', async (req, res) => {
  required(req.body, ['name', 'type']);
  const { name, type, initial_cost = 0, current_value, note } = req.body;
  const [asset] = await query(
    `INSERT INTO assets (name, type, initial_cost, current_value, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, type, initial_cost, current_value ?? initial_cost, note || null],
  );
  res.status(201).json(asset);
});

// Edit detail aset. Nilai sekarang diubah lewat "Perbarui nilai".
router.put('/:id', async (req, res) => {
  required(req.body, ['name', 'type']);
  const { name, type, initial_cost = 0, note } = req.body;
  const [asset] = await query(
    `UPDATE assets SET name = $1, type = $2, initial_cost = $3, note = $4, updated_at = now()
     WHERE id = $5 RETURNING *`,
    [name, type, initial_cost, note || null, req.params.id],
  );
  if (!asset) throw new HttpError(404, 'Aset tidak ditemukan');
  res.json(asset);
});

router.put('/:id/value', async (req, res) => {
  required(req.body, ['current_value']);
  const [asset] = await query(
    'UPDATE assets SET current_value = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [req.body.current_value, req.params.id],
  );
  if (!asset) throw new HttpError(404, 'Aset tidak ditemukan');
  res.json(asset);
});

// Beli (uang keluar dari akun ke aset) atau jual (uang kembali ke akun).
// Nilai aset ikut naik/turun sebesar nominal transaksi.
const tradeAsset = (isBuy) => async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);

  await withTransaction(async (client) => {
    const { rows: [asset] } = await client.query('SELECT * FROM assets WHERE id = $1', [req.params.id]);
    if (!asset) throw new HttpError(404, 'Aset tidak ditemukan');

    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, asset_id, date, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        isBuy ? 'asset_out' : 'asset_in',
        req.body.amount,
        req.body.account_id,
        asset.id,
        req.body.date,
        `${isBuy ? 'Beli' : 'Jual'} ${asset.name}`,
      ],
    );
    await client.query(
      `UPDATE assets SET current_value = GREATEST(current_value + $1, 0), updated_at = now() WHERE id = $2`,
      [isBuy ? req.body.amount : -req.body.amount, asset.id],
    );
  });
  res.status(204).end();
};

router.post('/:id/buy', tradeAsset(true));
router.post('/:id/sell', tradeAsset(false));

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM assets WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

export default router;
