import { api } from '../api.js';
import { formatDate, daysUntil, todayISO, currentMonth, formatAmountInput, shortMonthLabel } from '../format.js';
import { budgetAlerts } from '../budget-alerts.js';
import { taxShareOf, TAX_METHODS } from '../tax-calc.js';

// Kartu-kartu di Beranda: perkiraan tabungan, dana darurat (freelance), invoice, dan kondisi kosong.
export default {
  get hasTrendData() {
    return this.summary?.trend.some((row) => row.income > 0 || row.expense > 0);
  },

  // Perbandingan dengan periode sebelumnya (trend: 6 periode, terakhir = periode ini).
  // Pemasukan naik = bagus; pengeluaran naik = perlu perhatian.
  kpiChange(key) {
    const trend = this.summary?.trend;
    if (!trend || trend.length < 2) return null;
    const now = trend.at(-1)[key];
    const before = trend.at(-2)[key];
    if (!before) return null;
    const percent = Math.round(((now - before) / before) * 100);
    const up = percent >= 0;
    const good = key === 'income' ? up : !up;
    return { up, tone: percent === 0 ? 'muted' : good ? 'positive' : 'negative', text: `${up ? '+' : ''}${percent}% vs ${shortMonthLabel(trend.at(-2).month)}` };
  },

  // Grafik batang mini 6 bulan untuk kartu pemasukan / pengeluaran.
  sparkBars(key) {
    const trend = this.summary?.trend ?? [];
    const max = Math.max(1, ...trend.map((row) => row[key]));
    return trend.map((row, index) => ({
      month: row.month,
      label: shortMonthLabel(row.month),
      value: row[key],
      height: row[key] ? Math.max(8, (row[key] / max) * 100) : 4,
      current: index === trend.length - 1,
    }));
  },

  get hasSavingsData() {
    const savings = this.summary?.savings;
    return Boolean(savings && (savings.income > 0 || savings.dailyExpense > 0));
  },

  // Label perkiraan tabungan: Sehat ≥ 20%, Cukup 10–20%, Tipis < 10%, Minus < 0.
  get savingsMood() {
    const savings = this.summary?.savings;
    if (!savings) return null;
    if (savings.estimate < 0) return { label: 'Minus', emoji: '26a0-fe0f', tone: 'danger', tip: 'Pengeluaran lebih besar dari pemasukan. Coba cek kategori terbesar di bawah.' };
    if (savings.percent >= 20) return { label: 'Sehat', emoji: '1f331', tone: 'ok', tip: 'Mantap! Kamu menabung di atas 20% pemasukan.' };
    if (savings.percent >= 10) return { label: 'Cukup', emoji: '1f60a', tone: 'info', tip: 'Lumayan. Targetkan minimal 20% dari pemasukan.' };
    return { label: 'Tipis', emoji: '1f62c', tone: 'warning', tip: 'Ruang menabung masih kecil. Cek anggaran & langganan yang bisa dikurangi.' };
  },

  // Dana darurat freelancer: < 3 bulan bahaya, 3–6 cukup, ≥ 6 aman.
  get runway() {
    const months = this.summary?.runwayMonths;
    if (months === null || months === undefined) return null;
    const tone = months < 3 ? 'danger' : months < 6 ? 'warning' : 'ok';
    const label = months < 3 ? 'Perlu ditambah' : months < 6 ? 'Lumayan' : 'Aman';
    return { months, tone, label, text: months >= 24 ? '24+ bulan' : `${months.toFixed(1).replace('.', ',')} bulan` };
  },

  // ---------- Target dana darurat (Pengaturan → Penghasilan) ----------

  get emergencyTarget() {
    return this.summary?.emergency?.targetMonths ?? 6;
  },

  // Skala garis: sampai 12 bulan, atau lebih kalau targetnya lebih dari 12.
  get runwayScale() {
    return Math.max(12, this.emergencyTarget);
  },

  get emergencyText() {
    const emergency = this.summary?.emergency;
    const need = `Kebutuhan ${this.money(this.summary.savings.monthlyNeed)}/bulan`;
    if (!emergency?.target) return need;
    if (emergency.gap === 0) return `${need} · target ${emergency.targetMonths} bulan tercapai 🎉`;
    const when = emergency.monthsToGo
      ? ` · tercapai ±${emergency.monthsToGo} bulan lagi kalau menabung ${this.money(emergency.monthlySaving)}/bulan`
      : '';
    return `Kurang ${this.money(emergency.gap)} untuk target ${emergency.targetMonths} bulan${when}`;
  },

  get isCurrentPeriod() {
    return !this.range && this.month === currentMonth(this.monthStartDay);
  },

  // Peringatan anggaran hanya untuk periode yang sedang berjalan.
  get budgetAlerts() {
    if (!this.summary || !this.isCurrentPeriod) return [];
    return budgetAlerts(this.summary.categories, this.summary.period, todayISO());
  },

  get hasBudgets() {
    return Boolean(this.summary?.categories.some((category) => category.monthly_budget));
  },

  // ---------- Pajak freelance ----------

  get taxEnabled() {
    return Boolean(this.summary?.tax);
  },

  // Bagian pajak dari sebuah pemasukan (dipakai untuk pengingat setelah pemasukan dicatat).
  // NPPN & PPh Final tidak linear: bagian pajak tergantung pemasukan sebelumnya di tahun ini.
  // amount = uang diterima; withheld = PPh 21 yang sudah dipotong klien (mengurangi yang perlu disisihkan).
  taxShare(amount, categoryId = null, withheld = 0) {
    const tax = this.summary?.tax;
    if (!tax) return 0;
    if (categoryId !== null && !tax.categoryIds.includes(Number(categoryId))) return 0;
    return Math.max(0, taxShareOf(amount + withheld, tax.taxableIncome, tax) - withheld);
  },

  get taxMethodText() {
    const tax = this.summary?.tax;
    if (!tax) return '';
    if (tax.method === 'flat') return `${String(tax.rate).replace('.', ',')}% dari pemasukan kena pajak`;
    const label = TAX_METHODS[tax.method].label;
    return `${label} · tarif efektif ${String(tax.effectiveRate).replace('.', ',')}% dari bruto`;
  },

  openTaxPay() {
    this.open('taxPay', { amountText: formatAmountInput(this.summary.tax.outstanding || '') });
  },

  async payTax() {
    if (!(await this.confirmEnoughBalance(this.form.account_id, this.parsedAmount))) return;
    return this.submit(async () => {
      await api.post('/tax/pay', {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        date: this.form.date,
        note: this.form.note,
      });
    }, 'Pembayaran pajak tercatat');
  },

  invoiceStatus(invoice) {
    if (!invoice.due_date) return { text: 'Tanpa jatuh tempo', tone: 'neutral' };
    const days = daysUntil(invoice.due_date);
    if (days < 0) return { text: `Telat ${-days} hari`, tone: 'danger' };
    if (days === 0) return { text: 'Jatuh tempo hari ini', tone: 'warning' };
    return { text: `Jatuh tempo ${formatDate(invoice.due_date)}`, tone: 'neutral' };
  },
};
