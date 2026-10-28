import { Router } from 'express';
import { query, HttpError } from '../db.js';
import { getTaxSettings, taxStatus } from '../tax.js';

// Laporan tahunan (tahun kalender, Januari–Desember).
const router = Router();

const yearRange = (year) => [`${year}-01-01`, `${year + 1}-01-01`];

async function yearTotals(year) {
  const [row] = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::bigint  AS income,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::bigint AS expense,
            count(*) FILTER (WHERE kind IN ('income', 'expense'))::int     AS transaction_count
     FROM transactions WHERE date >= $1 AND date < $2`,
    yearRange(year),
  );
  return { ...row, net: row.income - row.expense };
}

// Persentase perubahan dibanding tahun lalu (null jika tahun lalu kosong).
const change = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);

router.get('/yearly', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  if (year < 2000 || year > 2100) throw new HttpError(400, 'Tahun tidak valid');
  const [start, end] = yearRange(year);

  const [totals, previous, months, byCategory, byClient, topExpenses, movements, netWorth, years, taxSettings] =
    await Promise.all([
      yearTotals(year),
      yearTotals(year - 1),

      query(
        `SELECT to_char(m, 'YYYY-MM') AS month,
                COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::bigint  AS income,
                COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::bigint AS expense
         FROM generate_series($1::date, $2::date - interval '1 month', interval '1 month') AS m
         LEFT JOIN transactions t ON date_trunc('month', t.date) = m
         GROUP BY m ORDER BY m`,
        [start, end],
      ),

      query(
        `SELECT t.kind, c.id, COALESCE(c.name, 'Tanpa kategori') AS name,
                COALESCE(c.icon, 'tag') AS icon, COALESCE(c.color, '#94a3b8') AS color,
                SUM(t.amount)::bigint AS total, count(*)::int AS count
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.kind IN ('income', 'expense') AND t.date >= $1 AND t.date < $2
         GROUP BY t.kind, c.id ORDER BY total DESC`,
        [start, end],
      ),

      // Pemasukan per klien: pembayaran invoice + proyek yang langsung dicatat sebagai pemasukan.
      query(
        `SELECT t.client AS name, SUM(t.amount)::bigint AS total, count(*)::int AS count
         FROM transactions t
         WHERE t.kind = 'income' AND t.client IS NOT NULL AND t.date >= $1 AND t.date < $2
         GROUP BY t.client ORDER BY total DESC`,
        [start, end],
      ),

      query(
        `SELECT t.id, t.date, t.amount, t.note, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.kind = 'expense' AND t.date >= $1 AND t.date < $2
         ORDER BY t.amount DESC, t.date LIMIT 5`,
        [start, end],
      ),

      // Uang yang dipakai untuk melunasi utang & berinvestasi (bukan pengeluaran, tapi penting).
      query(
        `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'debt_out' AND d.direction = 'payable'), 0)::bigint AS debt_paid,
                COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'asset_out'), 0)::bigint
                  - COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'asset_in'), 0)::bigint AS invested
         FROM transactions t LEFT JOIN debts d ON d.id = t.debt_id
         WHERE t.date >= $1 AND t.date < $2`,
        [start, end],
      ),

      query(
        `SELECT month, value FROM net_worth_snapshots WHERE month >= $1 AND month < $2 ORDER BY month`,
        [`${year}-01`, `${year + 1}-01`],
      ),

      // Tahun yang punya data, untuk pilihan tahun di halaman.
      query(`SELECT DISTINCT extract(year FROM date)::int AS year FROM transactions ORDER BY year DESC`),

      getTaxSettings(),
    ]);

  const currentMonth = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const share = (rows, total) => rows.map((row) => ({ ...row, percent: total ? Math.round((row.total / total) * 1000) / 10 : 0 }));
  const activeMonths = months.filter((row) => row.income > 0 || row.expense > 0);
  const byExpense = [...activeMonths].sort((a, b) => b.expense - a.expense);
  const tax = await taxStatus(year);

  res.json({
    year,
    years: [...new Set([year, ...years.map((row) => row.year)])].sort((a, b) => b - a),
    totals: {
      ...totals,
      savingsRate: totals.income > 0 ? Math.round((totals.net / totals.income) * 1000) / 10 : null,
      monthlyAverageExpense: activeMonths.length ? Math.round(totals.expense / activeMonths.length) : 0,
      activeMonths: activeMonths.length,
    },
    previous,
    changes: {
      income: change(totals.income, previous.income),
      expense: change(totals.expense, previous.expense),
      net: change(totals.net, previous.net),
    },
    // Bulan yang belum terjadi ditandai, supaya grafik tidak menampilkan "tabungan 0".
    months: months.map((row) => ({ ...row, net: row.income - row.expense, future: row.month > currentMonth })),
    expenseByCategory: share(byCategory.filter((row) => row.kind === 'expense'), totals.expense)
      .map((row) => ({ ...row, monthlyAverage: activeMonths.length ? Math.round(row.total / activeMonths.length) : 0 })),
    incomeByCategory: share(byCategory.filter((row) => row.kind === 'income'), totals.income),
    incomeByClient: share(byClient, totals.income),
    topExpenses,
    extremes: activeMonths.length
      ? { mostExpensive: byExpense[0], mostFrugal: byExpense[byExpense.length - 1] }
      : null,
    debtPaid: movements[0].debt_paid,
    invested: movements[0].invested,
    netWorth: netWorth.length ? { start: netWorth[0], end: netWorth[netWorth.length - 1] } : null,
    tax: taxSettings.enabled || tax.paid > 0 ? tax : null,
  });
});

export default router;
