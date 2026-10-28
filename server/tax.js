import { pool, query } from './db.js';

// Pajak freelance: setiap pemasukan dari kategori kena pajak "menyisihkan" tax_rate % ke dana pajak.
// Pembayaran pajak = pengeluaran kategori "Pajak". Dihitung per tahun kalender (tahun pajak Indonesia).
//
//   harus disisihkan = pemasukan kena pajak tahun ini × tarif
//   sisa dana pajak  = harus disisihkan − sudah dibayar (minimal 0)

export const TAX_CATEGORY_NAME = 'Pajak';

export async function getTaxSettings() {
  const [settings] = await query('SELECT income_mode, tax_rate, tax_category_ids FROM settings WHERE id = 1');
  return {
    enabled: settings.income_mode === 'freelance' && settings.tax_rate > 0,
    rate: settings.tax_rate,
    categoryIds: settings.tax_category_ids,
  };
}

// Kategori pengeluaran "Pajak"; dibuat otomatis bila belum ada. db = pool atau client transaksi.
export async function taxCategoryId(db = pool) {
  const { rows: [existing] } = await db.query(
    `SELECT id FROM categories WHERE kind = 'expense' AND name = $1 LIMIT 1`, [TAX_CATEGORY_NAME],
  );
  if (existing) return existing.id;
  const { rows: [created] } = await db.query(
    `INSERT INTO categories (name, kind, icon, color) VALUES ($1, 'expense', 'bank', '#0f766e') RETURNING id`,
    [TAX_CATEGORY_NAME],
  );
  return created.id;
}

// Pemasukan kena pajak & pajak dibayar dalam rentang tanggal [start, end).
export async function taxTotals(start, end, categoryIds) {
  const [row] = await query(
    `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income' AND t.category_id = ANY($3)), 0)::bigint AS taxable_income,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense' AND c.name = $4 AND c.kind = 'expense'), 0)::bigint AS paid
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date < $2`,
    [start, end, categoryIds, TAX_CATEGORY_NAME],
  );
  return row;
}

export const taxFor = (amount, rate) => Math.round((amount * rate) / 100);

// Ringkasan dana pajak untuk satu tahun.
export async function taxStatus(year) {
  const settings = await getTaxSettings();
  const { taxable_income: taxableIncome, paid } = await taxTotals(`${year}-01-01`, `${year + 1}-01-01`, settings.categoryIds);
  const owed = taxFor(taxableIncome, settings.rate);
  return {
    ...settings,
    year,
    taxableIncome,
    owed,
    paid,
    outstanding: Math.max(0, owed - paid),
  };
}
