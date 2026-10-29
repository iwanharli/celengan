import { query } from './db.js';
import { periodRange, getStartDay, currentMonth } from './period.js';
import { savingsEstimate } from './savings.js';
import { effectiveBudget } from './budget.js';
import { getTaxSettings, taxStatus } from './tax.js';
import { taxDeadlines } from './insights.js';
import { sendToAll } from './notify.js';

// Kotak notifikasi (halaman Notifikasi). Notifikasi dibuat dari kondisi data saat ini:
// tagihan, saldo kurang, utang, anggaran, posisi LP kripto, dan tenggat pajak.
// Tiap notifikasi punya kunci unik, jadi kondisi yang sama tidak dicatat dua kali.

const rupiah = (amount) => `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

async function billNotices(today) {
  const bills = await query(
    `SELECT b.id, b.name, b.amount, b.next_due::text AS next_due, b.debt_id, a.name AS account_name, ab.balance
     FROM bills b LEFT JOIN accounts a ON a.id = b.account_id LEFT JOIN account_balances ab ON ab.id = b.account_id
     WHERE b.active AND b.next_due <= $1::date + 7`,
    [today],
  );
  const notices = [];
  for (const bill of bills) {
    const days = daysBetween(today, bill.next_due);
    const what = bill.debt_id ? 'Cicilan' : 'Tagihan';
    if (days < 0) {
      notices.push({ key: `bill-late:${bill.id}:${bill.next_due}`, kind: 'bill', tone: 'danger', icon: 'warning-circle', page: 'bills',
        title: `${what} ${bill.name} telat`, body: `${rupiah(bill.amount)} jatuh tempo ${-days} hari lalu. Sudah dibayar? Catat di halaman Tagihan.` });
    } else if (days <= 1) {
      notices.push({ key: `bill-due:${bill.id}:${bill.next_due}:${days}`, kind: 'bill', tone: 'warning', icon: 'calendar-check', page: 'bills',
        title: `${what} ${bill.name} ${days === 0 ? 'jatuh tempo hari ini' : 'jatuh tempo besok'}`,
        body: `${rupiah(bill.amount)}${bill.account_name ? ` dari ${bill.account_name}` : ''}.` });
    }
    if (bill.balance != null && bill.balance < bill.amount) {
      notices.push({ key: `bill-short:${bill.id}:${bill.next_due}`, kind: 'bill', tone: 'danger', icon: 'wallet', page: 'bills', push: true,
        title: `Saldo ${bill.account_name} kurang untuk ${bill.name}`,
        body: `Kurang ${rupiah(bill.amount - bill.balance)} — jatuh tempo ${days < 0 ? 'sudah lewat' : days === 0 ? 'hari ini' : `${days} hari lagi`}. Isi saldo dulu ya.` });
    }
  }
  return notices;
}

// Utang tanpa jadwal cicilan dengan tanggal pelunasan ≤ 3 hari lagi (yang pakai cicilan sudah lewat tagihan).
async function debtNotices(today) {
  const debts = await query(
    `SELECT d.id, d.counterparty, d.direction, d.type, d.remaining, d.due_date::text AS due_date
     FROM debt_status d
     WHERE d.remaining > 0 AND d.due_date IS NOT NULL AND d.due_date <= $1::date + 3
       AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.debt_id = d.id AND b.active)`,
    [today],
  );
  return debts.map((debt) => {
    const days = daysBetween(today, debt.due_date);
    const when = days < 0 ? `lewat ${-days} hari` : days === 0 ? 'hari ini' : `${days} hari lagi`;
    const payable = debt.direction === 'payable';
    const label = debt.type === 'invoice' ? 'Invoice' : payable ? 'Utang ke' : 'Piutang dari';
    return {
      key: `debt-due:${debt.id}:${debt.due_date}:${days < 0 ? 'late' : 'soon'}`, kind: 'debt', tone: days < 0 ? 'danger' : 'warning',
      icon: payable ? 'hand-coins' : 'hand-arrow-down', page: 'debts',
      title: `${label} ${debt.counterparty} jatuh tempo ${when}`,
      body: `Sisa ${rupiah(debt.remaining)}.${payable ? '' : ' Saatnya ditagih.'}`,
    };
  });
}

// Anggaran kategori periode ini: peringatan di 80% dan saat terlampaui.
async function budgetNotices(today) {
  const startDay = await getStartDay();
  const month = currentMonth(startDay, new Date(`${today}T12:00:00`));
  const period = periodRange(month, startDay);
  const [[{ income_mode: incomeMode }], taxSettings] = await Promise.all([
    query('SELECT income_mode FROM settings WHERE id = 1'),
    getTaxSettings(),
  ]);
  const [categories, savings] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.monthly_budget, c.budget_percent, COALESCE(SUM(t.amount), 0)::bigint AS spent
       FROM categories c
       LEFT JOIN transactions t ON t.category_id = c.id AND t.kind = 'expense' AND t.date >= $1 AND t.date < $2
       WHERE c.kind = 'expense' AND NOT c.archived AND (c.monthly_budget > 0 OR c.budget_percent > 0)
       GROUP BY c.id`,
      [period.start, period.end],
    ),
    savingsEstimate(month, startDay, incomeMode, taxSettings),
  ]);
  const notices = [];
  for (const category of categories) {
    const budget = effectiveBudget(category, savings.income);
    if (!(budget > 0)) continue;
    const used = category.spent / budget;
    if (used >= 1) {
      notices.push({ key: `budget-over:${category.id}:${month}`, kind: 'budget', tone: 'danger', icon: 'chart-pie-slice', page: 'budget',
        title: `Anggaran ${category.name} terlampaui`,
        body: `Terpakai ${rupiah(category.spent)} dari ${rupiah(budget)} (lebih ${rupiah(category.spent - budget)}).` });
    } else if (used >= 0.8) {
      notices.push({ key: `budget-80:${category.id}:${month}`, kind: 'budget', tone: 'warning', icon: 'chart-pie-slice', page: 'budget',
        title: `Anggaran ${category.name} tinggal ${Math.round((1 - used) * 100)}%`,
        body: `Sisa ${rupiah(budget - category.spent)} dari ${rupiah(budget)} untuk periode ini.` });
    }
  }
  return notices;
}

// Posisi LP di luar rentang harga: tidak menghasilkan fee. Satu notifikasi per posisi per hari.
async function walletNotices(today) {
  const wallets = await query(`SELECT id, name, wallet_tokens FROM assets WHERE wallet_address IS NOT NULL AND wallet_tokens IS NOT NULL`);
  const notices = [];
  for (const wallet of wallets) {
    for (const lp of wallet.wallet_tokens.positions ?? []) {
      if (!lp.range || lp.range.in_range) continue;
      const below = lp.range.current < lp.range.lower;
      notices.push({ key: `lp-out:${lp.position}:${today}`, kind: 'asset', tone: 'danger', icon: 'drop-half', page: 'assets', push: true,
        title: `LP ${lp.label} di luar rentang`,
        body: `Harga ${below ? 'turun di bawah' : 'naik di atas'} rentang posisi Meteora di ${wallet.name}, jadi tidak menghasilkan fee. Nilai posisi ${rupiah(lp.value)}.` });
    }
  }
  return notices;
}

async function taxNotices(today) {
  const settings = await getTaxSettings();
  if (!settings.enabled) return [];
  const status = await taxStatus(Number(today.slice(0, 4)));
  return taxDeadlines(today, status).map((item, index) => ({
    key: `tax:${today.slice(0, 7)}:${index}:${item.icon}`, kind: 'tax', tone: item.tone, icon: item.icon, page: item.page,
    title: 'Tenggat pajak', body: item.text,
  }));
}

// Kumpulkan & simpan notifikasi baru. Yang bertanda push juga dikirim ke browser (kalau aktif).
export async function collectNotifications(today = new Date().toLocaleDateString('sv-SE')) {
  const groups = await Promise.allSettled([billNotices(today), debtNotices(today), budgetNotices(today), walletNotices(today), taxNotices(today)]);
  const notices = groups.flatMap((group) => {
    if (group.status === 'rejected') console.error('Notifikasi gagal dibuat:', group.reason?.message);
    return group.status === 'fulfilled' ? group.value : [];
  });
  let created = 0;
  for (const notice of notices) {
    const [row] = await query(
      `INSERT INTO notifications (key, kind, tone, icon, page, title, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO NOTHING RETURNING id`,
      [notice.key, notice.kind, notice.tone, notice.icon, notice.page, notice.title, notice.body],
    );
    if (!row) continue;
    created += 1;
    if (notice.push) await sendToAll({ title: notice.title, body: notice.body, url: `/#${notice.page}`, tag: notice.key }).catch(() => {});
  }
  return created;
}

export function scheduleNotifications() {
  const run = () => collectNotifications().catch((error) => console.error('Notifikasi gagal:', error.message));
  run();
  setInterval(run, 15 * 60 * 1000).unref();
}
