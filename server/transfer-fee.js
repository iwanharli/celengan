import { HttpError } from './db.js';

// Biaya admin transfer / kiriman: pengeluaran kategori "Biaya admin" dari akun pengirim yang menempel
// ke transaksinya lewat fee_of (ikut terhapus saat transaksinya dihapus).

async function feeCategoryId(client) {
  const { rows: [existing] } = await client.query(
    `SELECT id FROM categories WHERE kind = 'expense' AND name = 'Biaya admin' LIMIT 1`,
  );
  if (existing) return existing.id;
  const { rows: [created] } = await client.query(
    `INSERT INTO categories (name, kind, icon, color) VALUES ('Biaya admin', 'expense', 'bank', '#94a3b8') RETURNING id`,
  );
  return created.id;
}

// Biaya admin dipotong dari akun pengirim, dicatat sebagai pengeluaran yang menempel ke transaksinya.
// Berlaku untuk transfer antar akun sendiri & pengeluaran (kiriman ke penerima, bayar ke rekening lain, top up).
// fee kosong/0 → biaya (kalau ada) dihapus.
export async function syncTransferFee(client, transfer, fee) {
  const hasFee = transfer.kind === 'transfer' || transfer.kind === 'expense';
  const amount = hasFee ? Number(fee) || 0 : 0;
  if (amount < 0) throw new HttpError(400, 'Biaya admin tidak valid');
  if (amount === 0) {
    await client.query('DELETE FROM transactions WHERE fee_of = $1', [transfer.id]);
    return;
  }
  let note = `Biaya admin${transfer.note ? `: ${transfer.note}` : ''}`;
  if (transfer.recipient_id || transfer.to_account_id) {
    const { rows: [target] } = transfer.recipient_id
      ? await client.query('SELECT name FROM recipients WHERE id = $1', [transfer.recipient_id])
      : await client.query('SELECT name FROM accounts WHERE id = $1', [transfer.to_account_id]);
    note = `Biaya transfer ke ${target?.name ?? 'akun lain'}`;
  }
  const { rowCount } = await client.query(
    'UPDATE transactions SET amount = $1, account_id = $2, date = $3, note = $4 WHERE fee_of = $5',
    [amount, transfer.account_id, transfer.date, note, transfer.id],
  );
  if (!rowCount) {
    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note, fee_of)
       VALUES ('expense', $1, $2, $3, $4, $5, $6)`,
      [amount, transfer.account_id, await feeCategoryId(client), transfer.date, note, transfer.id],
    );
  }
}
