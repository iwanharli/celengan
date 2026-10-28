import { query } from './db.js';
import { periodRange, shiftMonth } from './period.js';

// Wawasan otomatis untuk Beranda: kalimat pendek dari data periode ini.
// Setiap wawasan: { icon, tone ('positive' | 'warning' | 'danger' | 'info'), text, page? }.
// Diurutkan dari yang paling perlu perhatian, maksimal 5.

const rupiah = (amount) => `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
const toISO = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
};
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

const MIN_CHANGE = 50000; // perubahan kategori di bawah ini dianggap tidak penting
const PRIORITY = { danger: 0, warning: 1, info: 2, positive: 3 };

// Tenggat pajak freelancer (tax = taxStatus tahun berjalan, atau null kalau fitur pajak mati):
//   - 1 Jan–31 Mar: lapor SPT Tahunan tahun lalu; NPPN juga wajib memberi tahu DJP sebelum 31 Maret
//   - PPh Final 0,5% setelah omzet lewat Rp500 juta: setor tiap bulan paling lambat tanggal 15
export function taxDeadlines(today, tax) {
  if (!tax) return [];
  const result = [];
  const [year, month, day] = today.split('-').map(Number);
  if (month <= 3) {
    const left = daysBetween(today, `${year}-03-31`);
    const when = left === 0 ? 'hari ini' : `${left} hari lagi`;
    const tone = left <= 14 ? 'danger' : 'warning';
    result.push({ icon: 'file-text', tone, page: 'settings', text: `Lapor SPT Tahunan ${year - 1} paling lambat 31 Maret (${when}). Siapkan ringkasan pajak dari kartu Dana pajak.` });
    if (tax.method === 'nppn') {
      result.push({ icon: 'envelope-simple', tone, page: 'settings', text: `Mau pakai NPPN untuk ${year}? Beri tahu DJP paling lambat 31 Maret (${when}), kalau terlewat wajib pembukuan.` });
    }
  }
  if (tax.method === 'final' && tax.taxableIncome > 500000000 && day <= 15) {
    const left = 15 - day;
    result.push({ icon: 'bank', tone: left <= 3 ? 'danger' : 'warning', page: 'settings', text: `Omzet tahun ini sudah lewat Rp500 juta: setor PPh Final 0,5% bulan lalu paling lambat tanggal 15 (${left === 0 ? 'hari ini' : `${left} hari lagi`}).` });
  }
  return result;
}

export async function buildInsights(period, startDay, today = new Date().toLocaleDateString('sv-SE'), tax = null) {
  const insights = taxDeadlines(today, tax);

  // Periode yang sedang berjalan dibandingkan secara adil: hari ke-1..N vs hari ke-1..N periode lalu.
  const previous = period.custom
    ? { start: addDays(period.start, -daysBetween(period.start, period.end)), end: period.start }
    : periodRange(shiftMonth(period.month, -1), startDay);
  const running = today >= period.start && today < period.end;
  const elapsed = running ? daysBetween(period.start, today) + 1 : daysBetween(period.start, period.end);
  const currentEnd = running ? addDays(today, 1) : period.end;
  const previousEnd = running ? addDays(previous.start, elapsed) : previous.end;

  const [categories, [totals], [fees], [biggest], dueSoon] = await Promise.all([
    query(
      `SELECT c.name,
              COALESCE(SUM(t.amount) FILTER (WHERE t.date >= $1 AND t.date < $2), 0)::bigint AS now,
              COALESCE(SUM(t.amount) FILTER (WHERE t.date >= $3 AND t.date < $4), 0)::bigint AS before
       FROM categories c JOIN transactions t ON t.category_id = c.id AND t.kind = 'expense'
       WHERE c.kind = 'expense' AND c.name NOT IN ('Biaya admin', 'Bayar utang', 'Pajak')
       GROUP BY c.id`,
      [period.start, currentEnd, previous.start, previousEnd],
    ),
    query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0)::bigint  AS income,
              COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0)::bigint AS expense
       FROM transactions WHERE date >= $1 AND date < $2`,
      [period.start, period.end],
    ),
    query(
      `SELECT COALESCE(SUM(t.amount), 0)::bigint AS total, COUNT(*)::int AS count
       FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE t.kind = 'expense' AND c.name = 'Biaya admin' AND t.date >= $1 AND t.date < $2`,
      [period.start, period.end],
    ),
    query(
      `SELECT t.amount, COALESCE(NULLIF(t.note, ''), c.name) AS label
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.kind = 'expense' AND t.date >= $1 AND t.date < $2
       ORDER BY t.amount DESC LIMIT 1`,
      [period.start, period.end],
    ),
    // Tagihan 7 hari ke depan (termasuk yang telat), dikelompokkan per akun pembayarnya.
    query(
      `SELECT a.name AS account_name, ab.balance, COUNT(*)::int AS count, SUM(b.amount)::bigint AS total
       FROM bills b LEFT JOIN accounts a ON a.id = b.account_id LEFT JOIN account_balances ab ON ab.id = b.account_id
       WHERE b.active AND b.next_due < $1::date + 7
       GROUP BY a.id, a.name, ab.balance`,
      [today],
    ),
  ]);

  // 1. Tagihan minggu ini: cukupkah saldo akunnya?
  if (dueSoon.length) {
    const count = dueSoon.reduce((sum, row) => sum + row.count, 0);
    const short = dueSoon.filter((row) => row.account_name && row.balance < row.total);
    if (short.length) {
      const names = short.map((row) => `${row.account_name} (kurang ${rupiah(row.total - row.balance)})`).join(', ');
      insights.push({ icon: 'warning-circle', tone: 'danger', page: 'bills', text: `${count} tagihan jatuh tempo minggu ini, tapi saldo ${names} belum cukup.` });
    } else {
      const total = dueSoon.reduce((sum, row) => sum + Number(row.total), 0);
      const covered = dueSoon.every((row) => row.account_name);
      insights.push({
        icon: 'calendar-check', tone: covered ? 'info' : 'warning', page: 'bills',
        text: `${count} tagihan jatuh tempo minggu ini (${rupiah(total)})${covered ? ', saldo akunnya cukup.' : '. Beberapa belum punya akun pembayar.'}`,
      });
    }
  }

  // 2. Kategori yang naik / turun paling banyak dibanding periode lalu.
  const label = running ? 'dibanding periode lalu di hari yang sama' : 'dibanding periode lalu';
  const changes = categories
    .filter((row) => row.before > 0 && Math.abs(row.now - row.before) >= MIN_CHANGE)
    .map((row) => ({ ...row, percent: Math.round(((row.now - row.before) / row.before) * 100) }));
  const up = changes.filter((row) => row.percent >= 25).sort((a, b) => (b.now - b.before) - (a.now - a.before))[0];
  const down = changes.filter((row) => row.percent <= -25).sort((a, b) => (a.now - a.before) - (b.now - b.before))[0];
  if (up) insights.push({ icon: 'trend-up', tone: 'warning', page: 'transactions', text: `${up.name} naik ${up.percent}% (+${rupiah(up.now - up.before)}) ${label}.` });
  if (down) insights.push({ icon: 'trend-down', tone: 'positive', page: 'transactions', text: `${down.name} turun ${-down.percent}% (hemat ${rupiah(down.before - down.now)}) ${label}. Mantap!` });

  // 3. Rasio menabung periode ini.
  if (totals.income > 0) {
    const rate = Math.round(((totals.income - totals.expense) / totals.income) * 100);
    if (rate < 0) insights.push({ icon: 'warning', tone: 'danger', text: `Pengeluaran lebih besar ${rupiah(totals.expense - totals.income)} dari pemasukan periode ini.` });
    else if (rate >= 20) insights.push({ icon: 'piggy-bank', tone: 'positive', text: `Kamu menyisihkan ${rate}% dari pemasukan periode ini. Target sehat minimal 20% — tercapai!` });
    else insights.push({ icon: 'piggy-bank', tone: 'info', text: `Baru ${rate}% pemasukan yang tersisa periode ini. Coba kejar minimal 20%.` });
  }

  // 4. Biaya admin transfer.
  if (fees.total > 0) {
    insights.push({ icon: 'bank', tone: 'info', page: 'transactions', text: `Biaya admin transfer periode ini ${rupiah(fees.total)} dari ${fees.count} transaksi.` });
  }

  // 5. Pengeluaran terbesar.
  if (biggest && totals.expense > 0 && biggest.amount >= totals.expense * 0.25) {
    const share = Math.round((biggest.amount / totals.expense) * 100);
    insights.push({ icon: 'receipt', tone: 'info', page: 'transactions', text: `Pengeluaran terbesar: ${biggest.label} ${rupiah(biggest.amount)} (${share}% dari total pengeluaran).` });
  }

  return insights.sort((a, b) => PRIORITY[a.tone] - PRIORITY[b.tone]).slice(0, 5);
}
