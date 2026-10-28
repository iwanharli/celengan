import { api } from '../api.js';
import { formatDate, daysUntil, todayISO, currentMonth, formatAmountInput } from '../format.js';
import { budgetAlerts } from '../budget-alerts.js';

// Kartu-kartu di Beranda: perkiraan tabungan, dana darurat (freelance), invoice, dan kondisi kosong.
export default {
  get hasTrendData() {
    return this.summary?.trend.some((row) => row.income > 0 || row.expense > 0);
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
  taxShare(amount, categoryId = null) {
    const tax = this.summary?.tax;
    if (!tax) return 0;
    if (categoryId !== null && !tax.categoryIds.includes(Number(categoryId))) return 0;
    return Math.round((amount * tax.rate) / 100);
  },

  openTaxPay() {
    this.open('taxPay', { amountText: formatAmountInput(this.summary.tax.outstanding || '') });
  },

  payTax() {
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
