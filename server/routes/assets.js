import { Router } from 'express';
import { query, withTransaction, required, HttpError } from '../db.js';
import { getStartDay, currentMonth } from '../period.js';
import { solanaWalletValue, isSolanaAddress } from '../solana-wallet.js';

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

// Perbarui nilai wallet dari alamatnya. Gagal (offline / dibatasi) → nilai terakhir tetap dipakai.
async function syncWallet(asset) {
  try {
    const wallet = await solanaWalletValue(asset.wallet_address);
    await query(
      `UPDATE assets SET current_value = $1, wallet_tokens = $2, synced_at = now(), sync_tried_at = now(), sync_error = NULL, updated_at = now()
       WHERE id = $3`,
      [wallet.value, JSON.stringify({ tokens: wallet.tokens, positions: wallet.positions, total_usd: wallet.total_usd, change_24h: wallet.change_24h, usd_idr: wallet.usd_idr }), asset.id],
    );
  } catch (error) {
    await query('UPDATE assets SET sync_error = $1, sync_tried_at = now() WHERE id = $2', [error.message, asset.id]);
  }
}

// Wallet yang belum diperbarui 10 menit terakhir. Dipanggil saat halaman Aset dimuat dan berkala dari server.
export function scheduleWalletSync() {
  setInterval(() => syncStaleWallets().catch((error) => console.error('Sinkron wallet gagal:', error.message)), 10 * 60 * 1000).unref();
}

export async function syncStaleWallets() {
  const stale = await query(
    `SELECT * FROM assets WHERE wallet_address IS NOT NULL
       AND (sync_tried_at IS NULL OR sync_tried_at < now() - interval '10 minutes')`,
  );
  await Promise.all(stale.map(syncWallet));
}

function walletAddressFrom(body) {
  const address = body.type === 'crypto' ? body.wallet_address?.trim() || null : null;
  if (address && !isSolanaAddress(address)) throw new HttpError(400, 'Alamat wallet Solana tidak valid');
  return address;
}

router.get('/', async (req, res) => {
  // Wallet diperbarui di latar belakang supaya halaman tidak menunggu; nilai terbaru tampil di muatan berikutnya.
  syncStaleWallets().catch((error) => console.error('Sinkron wallet gagal:', error.message));
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
  const walletAddress = walletAddressFrom(req.body);
  const [asset] = await query(
    `INSERT INTO assets (name, type, initial_cost, current_value, note, wallet_address)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, type, initial_cost, current_value ?? initial_cost, note || null, walletAddress],
  );
  if (walletAddress) await syncWallet(asset);
  res.status(201).json(asset);
});

// Edit detail aset. Nilai sekarang diubah lewat "Perbarui nilai".
router.put('/:id', async (req, res) => {
  required(req.body, ['name', 'type']);
  const { name, type, initial_cost = 0, note } = req.body;
  const walletAddress = walletAddressFrom(req.body);
  const [asset] = await query(
    `UPDATE assets SET name = $1, type = $2, initial_cost = $3, note = $4, updated_at = now(),
            wallet_address = $6,
            wallet_tokens = CASE WHEN wallet_address IS NOT DISTINCT FROM $6 THEN wallet_tokens END,
            synced_at = CASE WHEN wallet_address IS NOT DISTINCT FROM $6 THEN synced_at END,
            sync_tried_at = CASE WHEN wallet_address IS NOT DISTINCT FROM $6 THEN sync_tried_at END
     WHERE id = $5 RETURNING *`,
    [name, type, initial_cost, note || null, req.params.id, walletAddress],
  );
  if (!asset) throw new HttpError(404, 'Aset tidak ditemukan');
  if (walletAddress && !asset.synced_at) await syncWallet(asset);
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
