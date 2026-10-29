import { Router } from 'express';
import { query } from '../db.js';
import { periodFromQuery, periodRange, shiftMonth, getStartDay } from '../period.js';
import { savingsEstimate } from '../savings.js';
import { effectiveBudget } from '../budget.js';
import { getTaxSettings, taxStatus, periodTaxReserve } from '../tax.js';
import { buildInsights } from '../insights.js';

const router = Router();

function emergencyStatus(targetMonths, savings, spendableBalance) {
  if (!(savings.monthlyNeed > 0)) return { targetMonths, target: null };
  const target = targetMonths * savings.monthlyNeed;
  const gap = Math.max(0, target - Math.max(0, spendableBalance));
  const monthsToGo = gap > 0 && savings.estimate > 0 ? Math.ceil(gap / savings.estimate) : null;
  return { targetMonths, target, gap, monthsToGo, monthlySaving: savings.estimate };
}

async function incomeAndExpense({ start, end }) {
  const [totals] = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::bigint  AS income,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::bigint AS expense
     FROM transactions
     WHERE date >= $1 AND date < $2`,
    [start, end],
  );
  return totals;
}

router.get('/', async (req, res) => {
  const period = await periodFromQuery(req.query);
  const startDay = await getStartDay();

  const lastSixPeriods = [5, 4, 3, 2, 1, 0].map((offset) =>
    periodRange(shiftMonth(period.month, -offset), startDay));

  const [{ income_mode: incomeMode, emergency_months: emergencyMonths }] = await query('SELECT income_mode, emergency_months FROM settings WHERE id = 1');
  const taxSettings = await getTaxSettings();

  const [accounts, totals, categories, trend, upcomingBills, debtTotals, billsBeforePeriodEnd, recent, savings, invoices] =
    await Promise.all([
      query('SELECT * FROM account_balances ORDER BY id'),

      incomeAndExpense(period),

      query(
        `SELECT c.id, c.name, c.icon, c.color, c.monthly_budget, c.budget_percent, c.archived,
                COALESCE(SUM(t.amount), 0)::bigint AS spent
         FROM categories c
         LEFT JOIN transactions t
                ON t.category_id = c.id AND t.kind = 'expense' AND t.date >= $1 AND t.date < $2
         WHERE c.kind = 'expense'
         GROUP BY c.id
         ORDER BY spent DESC, c.id`,
        [period.start, period.end],
      ),

      Promise.all(lastSixPeriods.map(async (range) => ({
        month: range.month,
        ...(await incomeAndExpense(range)),
      }))),

      query(
        `SELECT b.*, c.icon AS category_icon, c.color AS category_color, a.name AS account_name, ab.balance AS account_balance
         FROM bills b LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN accounts a ON a.id = b.account_id
         LEFT JOIN account_balances ab ON ab.id = b.account_id
         WHERE b.active AND b.next_due < current_date + 14
         ORDER BY b.next_due`,
      ),

      query(
        `SELECT COALESCE(SUM(remaining) FILTER (WHERE direction = 'payable'), 0)::bigint    AS payable,
                COALESCE(SUM(remaining) FILTER (WHERE direction = 'receivable'), 0)::bigint AS receivable,
                COALESCE(SUM(installment) FILTER (WHERE direction = 'payable' AND remaining > 0), 0)::bigint
                  AS monthly_installments
         FROM debt_status`,
      ),

      // Tagihan yang masih harus dibayar sebelum periode ini berakhir (termasuk yang telat).
      query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
         FROM bills WHERE active AND next_due < $1`,
        [period.end],
      ),

      query(
        `SELECT t.*, a.name AS account_name, ta.name AS to_account_name, c.name AS category_name,
                c.icon AS category_icon, c.color AS category_color, d.counterparty AS debt_name, s.name AS asset_name
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts ta ON ta.id = t.to_account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN debts d ON d.id = t.debt_id
         LEFT JOIN assets s ON s.id = t.asset_id
         ORDER BY t.date DESC, t.id DESC
         LIMIT 6`,
      ),

      savingsEstimate(period.month, startDay, incomeMode, taxSettings),

      query(
        `SELECT id, counterparty, note, remaining, due_date
         FROM debt_status
         WHERE type = 'invoice' AND remaining > 0
         ORDER BY due_date NULLS LAST, id`,
      ),
    ]);

  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);

  // Pajak tahun berjalan (untuk periode yang dipilih) + bagian pajak dari pemasukan periode ini.
  let tax = null;
  if (taxSettings.enabled) {
    const year = Number(period.month.slice(0, 4));
    tax = { ...(await taxStatus(year)), periodReserve: await periodTaxReserve(period, taxSettings) };
  }
  // Dana pajak yang belum dibayar bukan uang yang bisa dipakai.
  // Uang di akun tabungan impian (wishlist) & dana pajak bukan uang yang bisa dipakai.
  const goalBalance = accounts.filter((account) => account.type === 'goal').reduce((sum, account) => sum + account.balance, 0);
  const spendableBalance = totalBalance - goalBalance - (tax?.outstanding ?? 0);

  res.json({
    period,
    totalBalance,
    accounts,
    income: totals.income,
    expense: totals.expense,
    // Anggaran persen dihitung dari rata-rata pemasukan (sama dengan dasar perkiraan tabungan).
    categories: categories.map((category) => ({
      ...category,
      fixed_budget: category.monthly_budget,
      monthly_budget: effectiveBudget(category, savings.income),
    })),
    budgetIncome: savings.income,
    trend,
    upcomingBills,
    debts: debtTotals[0],
    billsDue: billsBeforePeriodEnd[0].total,
    safeToSpend: totalBalance - goalBalance - billsBeforePeriodEnd[0].total,
    goalBalance,
    recent,
    savings,
    // Freelance: berapa bulan saldo bisa menutup kebutuhan bulanan tanpa pemasukan baru.
    runwayMonths: savings.monthlyNeed > 0 ? Math.max(0, spendableBalance) / savings.monthlyNeed : null,
    // Target dana darurat: kekurangan & perkiraan kapan tercapai dengan kecepatan menabung sekarang.
    emergency: emergencyStatus(emergencyMonths, savings, spendableBalance),
    tax,
    insights: await buildInsights(period, startDay, undefined, tax ? await taxStatus(new Date().getFullYear()) : null),
    invoices: {
      items: invoices,
      total: invoices.reduce((sum, invoice) => sum + invoice.remaining, 0),
    },
  });
});

export default router;
