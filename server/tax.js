import { pool, query } from './db.js';
import { annualTax, taxShareOf } from '../public/js/tax-calc.js';

// Pajak freelance per tahun kalender (tahun pajak Indonesia). Cara hitungnya ada di public/js/tax-calc.js
// (dipakai juga di browser), sesuai metode di Pengaturan: NPPN, PPh Final 0,5%, atau persentase tetap.
//
//   bruto            = pemasukan kategori kena pajak + PPh 21 yang dipotong klien
//   pajak setahun    = annualTax(bruto)
//   sisa dana pajak  = pajak setahun − PPh 21 dipotong klien − sudah dibayar (minimal 0)
// Pembayaran pajak = pengeluaran kategori "Pajak".

export const TAX_CATEGORY_NAME = 'Pajak';

export async function getTaxSettings() {
  const [settings] = await query(
    'SELECT income_mode, tax_method, tax_rate, tax_norma, tax_ptkp, tax_category_ids FROM settings WHERE id = 1',
  );
  const method = settings.tax_method;
  return {
    enabled: settings.income_mode === 'freelance' && (method === 'flat' ? settings.tax_rate > 0 : method !== 'nppn' || settings.tax_norma > 0),
    method,
    rate: settings.tax_rate,
    norma: settings.tax_norma,
    ptkp: settings.tax_ptkp,
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

// Penghasilan bruto kena pajak, PPh 21 dipotong klien, & pajak dibayar dalam rentang [start, end).
export async function taxTotals(start, end, categoryIds) {
  const [row] = await query(
    `SELECT COALESCE(SUM(t.amount + t.tax_withheld) FILTER (WHERE t.kind = 'income' AND t.category_id = ANY($3)), 0)::bigint AS taxable_income,
            COALESCE(SUM(t.tax_withheld) FILTER (WHERE t.kind = 'income' AND t.category_id = ANY($3)), 0)::bigint AS withheld,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense' AND c.name = $4 AND c.kind = 'expense'), 0)::bigint AS paid
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date < $2`,
    [start, end, categoryIds, TAX_CATEGORY_NAME],
  );
  return row;
}

// Dana pajak untuk satu periode di dalam tahun pajaknya: pajak tambahan karena pemasukan periode ini,
// dikurangi PPh 21 yang sudah dipotong klien di periode ini.
export async function periodTaxReserve(period, settings) {
  const yearStart = `${period.start.slice(0, 4)}-01-01`;
  const [before, during] = await Promise.all([
    period.start > yearStart ? taxTotals(yearStart, period.start, settings.categoryIds) : { taxable_income: 0 },
    taxTotals(period.start, period.end, settings.categoryIds),
  ]);
  return Math.max(0, taxShareOf(during.taxable_income, before.taxable_income, settings) - during.withheld);
}

// Bahan lapor SPT Tahunan: penghasilan bruto per klien & per bulan, PPh 21 dipotong, dan pajak yang dibayar.
export async function taxReport(year) {
  const status = await taxStatus(year);
  const range = [`${year}-01-01`, `${year + 1}-01-01`, status.categoryIds];
  const [clients, months, payments] = await Promise.all([
    query(
      `SELECT COALESCE(NULLIF(t.client, ''), 'Tanpa nama klien') AS client, COUNT(*)::int AS count,
              SUM(t.amount + t.tax_withheld)::bigint AS gross, SUM(t.tax_withheld)::bigint AS withheld, SUM(t.amount)::bigint AS received
       FROM transactions t
       WHERE t.kind = 'income' AND t.date >= $1 AND t.date < $2 AND t.category_id = ANY($3)
       GROUP BY 1 ORDER BY gross DESC`,
      range,
    ),
    query(
      `SELECT to_char(t.date, 'YYYY-MM') AS month,
              SUM(t.amount + t.tax_withheld)::bigint AS gross, SUM(t.tax_withheld)::bigint AS withheld
       FROM transactions t
       WHERE t.kind = 'income' AND t.date >= $1 AND t.date < $2 AND t.category_id = ANY($3)
       GROUP BY 1 ORDER BY 1`,
      range,
    ),
    query(
      `SELECT t.date, t.amount, t.note, a.name AS account
       FROM transactions t JOIN categories c ON c.id = t.category_id JOIN accounts a ON a.id = t.account_id
       WHERE t.kind = 'expense' AND c.name = $3 AND t.date >= $1 AND t.date < $2
       ORDER BY t.date`,
      [`${year}-01-01`, `${year + 1}-01-01`, TAX_CATEGORY_NAME],
    ),
  ]);
  return { ...status, clients, months, payments };
}

// Ringkasan dana pajak untuk satu tahun.
export async function taxStatus(year) {
  const settings = await getTaxSettings();
  const { taxable_income: taxableIncome, withheld, paid } = await taxTotals(`${year}-01-01`, `${year + 1}-01-01`, settings.categoryIds);
  const owed = annualTax(taxableIncome, settings);
  return {
    ...settings,
    year,
    taxableIncome,
    owed,
    withheld,
    paid,
    outstanding: Math.max(0, owed - withheld - paid),
    effectiveRate: taxableIncome > 0 ? Math.round((owed / taxableIncome) * 10000) / 100 : 0,
  };
}
