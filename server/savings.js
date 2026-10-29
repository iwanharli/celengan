import { query } from './db.js';
import { periodRange, shiftMonth } from './period.js';
import { annualTax } from '../public/js/tax-calc.js';

// Perkiraan bisa menabung per bulan:
//   rata-rata pemasukan − rata-rata pengeluaran harian − tagihan rutin − cicilan utang
//
// - Rata-rata diambil dari 3 bulan (freelance: 6 bulan) sebelum periode yang dipilih,
//   karena bulan berjalan belum lengkap.
//   Bulan tanpa transaksi sama sekali tidak ikut dirata-rata.
// - Pengeluaran yang berasal dari tagihan (bill_id terisi) dikeluarkan dari rata-rata,
//   karena tagihan dihitung dari jadwalnya supaya tidak terhitung dua kali.

const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

async function periodTotals({ start, end }, taxCategoryIds = []) {
  const [row] = await query(
    `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::bigint                       AS income,
            COALESCE(SUM(t.amount + t.tax_withheld) FILTER (WHERE t.kind = 'income' AND t.category_id = ANY($3)), 0)::bigint
              AS taxable_income,
            COALESCE(SUM(t.tax_withheld) FILTER (WHERE t.kind = 'income' AND t.category_id = ANY($3)), 0)::bigint
              AS withheld,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::bigint                      AS expense,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'expense' AND t.bill_id IS NULL AND t.debt_id IS NULL), 0)::bigint AS daily_expense,
            COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'debt_out' AND d.direction = 'payable'), 0)::bigint
              AS debt_payments,
            count(*)::int AS transaction_count
     FROM transactions t
     LEFT JOIN debts d ON d.id = t.debt_id
     WHERE t.date >= $1 AND t.date < $2`,
    [start, end, taxCategoryIds],
  );
  return row;
}

const average = (rows, key) => Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length);

// tax: { enabled, rate, categoryIds } dari getTaxSettings() — pajak yang disisihkan tidak dihitung sebagai tabungan.
export async function savingsEstimate(month, startDay, incomeMode, tax = { enabled: false, rate: 0, categoryIds: [] }) {
  const isFreelance = incomeMode === 'freelance';
  const historyMonths = isFreelance ? 6 : 3;
  const previousPeriods = await Promise.all(
    Array.from({ length: historyMonths }, (_, index) =>
      periodTotals(periodRange(shiftMonth(month, -(index + 1)), startDay), tax.categoryIds)),
  );
  // Bulan yang dihitung = yang punya pemasukan atau pengeluaran harian. Bulan yang isinya hanya pembayaran
  // cicilan (misal cicilan lama yang dicatat mundur) tidak menggambarkan pola bulanan, jadi dilewati.
  let history = previousPeriods.filter((row) => row.income > 0 || row.daily_expense > 0);

  // Belum ada riwayat: pakai bulan berjalan saja, ditandai sebagai perkiraan kasar.
  const isRough = history.length < historyMonths;
  if (history.length === 0) history = [await periodTotals(periodRange(month, startDay), tax.categoryIds)];

  const [bills, relief] = await Promise.all([
    query('SELECT amount, frequency, debt_id FROM bills WHERE active'),
    // Utang bercicilan yang paling cepat selesai → tabungan naik setelahnya.
    query(
      `SELECT d.counterparty, d.installment, MAX(i.due_date) AS last_due
       FROM debt_status d
       JOIN debt_installments i ON i.debt_id = d.id
       WHERE d.direction = 'payable' AND d.remaining > 0 AND d.installment IS NOT NULL
       GROUP BY d.id, d.counterparty, d.installment
       ORDER BY last_due
       LIMIT 1`,
    ),
  ]);

  const monthly = (rows) => Math.round(rows.reduce((sum, bill) => sum + bill.amount * PER_MONTH[bill.frequency], 0));
  const income = average(history, 'income');
  const dailyExpense = average(history, 'daily_expense');
  const recurringBills = monthly(bills.filter((bill) => !bill.debt_id));
  const installments = monthly(bills.filter((bill) => bill.debt_id));
  // Pajak per bulan = pajak setahun (dari rata-rata bruto × 12) ÷ 12, dikurangi rata-rata PPh 21 yang sudah dipotong klien.
  const monthlyTax = (gross, withheld) => (tax.enabled ? Math.max(0, Math.round(annualTax(gross * 12, tax) / 12) - withheld) : 0);
  const taxReserve = monthlyTax(average(history, 'taxable_income'), average(history, 'withheld'));
  const estimate = income - dailyExpense - recurringBills - installments - taxReserve;
  const monthlyNeed = dailyExpense + recurringBills + installments;

  // Skenario bulan sepi (freelance): pakai pemasukan terendah dari riwayat.
  const lowestIncome = Math.min(...history.map((row) => row.income));
  const lowestMonth = history.find((row) => row.income === lowestIncome);
  const lowScenario = isFreelance && history.length > 1
    ? { income: lowestIncome, estimate: lowestIncome - monthlyNeed - monthlyTax(lowestMonth.taxable_income, lowestMonth.withheld) }
    : null;

  // "Benar-benar tersisa" bulan lalu, sebagai pembanding perkiraan.
  const lastMonth = previousPeriods[0];
  const actualLastMonth = lastMonth.transaction_count > 0
    ? lastMonth.income - lastMonth.expense - lastMonth.debt_payments
    : null;

  return {
    monthsUsed: history.length,
    historyMonths,
    monthlyNeed,
    lowScenario,
    isRough,
    income,
    dailyExpense,
    recurringBills,
    installments,
    taxReserve,
    estimate,
    percent: income > 0 ? Math.round((estimate / income) * 100) : null,
    actualLastMonth,
    relief: relief[0]
      ? { name: relief[0].counterparty, lastDue: relief[0].last_due, newEstimate: estimate + relief[0].installment }
      : null,
  };
}
