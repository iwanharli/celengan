import { api } from '../api.js';
import { formatDate, daysUntil, formatAmountInput } from '../format.js';

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
};

const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

// Halaman Tagihan: tagihan rutin, bayar, lewati, tambah & edit.
export default {
  billTab: 'active',
  billStatus(bill) {
    if (bill.auto_pay_blocked) return { text: 'Saldo kurang, belum terpotong', tone: 'danger' };
    const days = daysUntil(bill.next_due);
    if (days < 0) return { text: `Telat ${-days} hari`, tone: 'danger' };
    if (days === 0) return { text: 'Hari ini', tone: 'danger' };
    if (days <= 3) return { text: `${days} hari lagi`, tone: 'warning' };
    return { text: formatDate(bill.next_due), tone: 'neutral' };
  },

  get monthlyBillsTotal() {
    return Math.round(this.bills.reduce((sum, bill) => sum + bill.amount * PER_MONTH[bill.frequency], 0));
  },

  // Tanpa argumen: tagihan baru. Dengan tagihan: edit.
  openBill(bill = null) {
    this.open('bill', bill
      ? {
        id: bill.id,
        debt_id: bill.debt_id,
        name: bill.name,
        amountText: formatAmountInput(bill.amount),
        frequency: bill.frequency,
        date: bill.next_due,
        category_id: bill.category_id ?? '',
        account_id: bill.account_id ?? '',
        auto_pay: bill.auto_pay,
      }
      : { frequency: 'monthly', category_id: this.categoriesOf('expense')[0]?.id, account_id: this.defaultAccountId, auto_pay: true });
  },

  saveBill() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      const body = {
        name: this.form.name,
        amount: this.requireAmount(),
        frequency: this.form.frequency,
        next_due: this.form.date,
        category_id: Number(this.form.category_id) || null,
        account_id: Number(this.form.account_id) || null,
        auto_pay: Boolean(this.form.auto_pay),
      };
      if (isNew) await api.post('/bills', body);
      else await api.put(`/bills/${this.form.id}`, body);
    }, isNew ? 'Tagihan ditambahkan' : 'Tagihan diperbarui');
  },

  openPayBill(bill) {
    this.open('payBill', { bill, amountText: formatAmountInput(bill.amount), account_id: bill.account_id ?? this.defaultAccountId });
  },

  async payBill() {
    if (!(await this.confirmEnoughBalance(this.form.account_id, this.parsedAmount))) return;
    return this.submit(async () => {
      await api.post(`/bills/${this.form.bill.id}/pay`, {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        date: this.form.date,
      });
    }, 'Tagihan dibayar', 'small');
  },

  // Perkiraan jatuh tempo berikutnya (sama dengan next_due_date di schema.sql).
  nextDueAfter(bill) {
    if (bill.frequency === 'weekly') return addDays(bill.next_due, 7);
    const [year, month] = bill.next_due.split('-').map(Number);
    const target = new Date(year, month - 1 + (bill.frequency === 'yearly' ? 12 : 1), 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(bill.due_day ?? Number(bill.next_due.slice(8)), lastDay));
    return target.toLocaleDateString('sv-SE');
  },

  async openBillHistory(bill) {
    this.open('billHistory', { bill, history: null });
    this.form.history = await api.get(`/bills/${bill.id}/history`);
  },

  skipBill(bill) {
    this.askConfirm({
      title: `Lewati ${bill.name} periode ini?`,
      emoji: '23ed-fe0f',
      tone: 'info',
      message: 'Tagihan periode ini dianggap tidak perlu dibayar. Tidak ada transaksi yang dicatat, tapi tetap tercatat di riwayat tagihan.',
      details: [
        { icon: 'calendar-x', text: `Jatuh tempo sekarang: ${formatDate(bill.next_due)}` },
        { icon: 'calendar-check', text: `Berikutnya: ${formatDate(this.nextDueAfter(bill))}` },
      ],
      confirmLabel: 'Lewati',
      successMessage: 'Tagihan dilewati',
    }, () => api.post(`/bills/${bill.id}/skip`));
  },

  // Berhenti langganan: tagihan pindah ke tab "Berhenti", riwayatnya tetap bisa dibuka.
  stopBill(bill) {
    this.askConfirm({
      title: `Berhenti langganan ${bill.name}?`,
      emoji: '1f6d1',
      tone: 'warning',
      message: 'Pengingat dan potong otomatis berhenti mulai hari ini. Tagihannya pindah ke tab Berhenti dan bisa diaktifkan lagi kapan saja.',
      details: [
        { icon: 'coins', text: `${this.money(bill.amount)} · ${this.FREQUENCIES[bill.frequency]}` },
        { icon: 'clock-counter-clockwise', text: 'Riwayat pembayaran tetap tersimpan' },
      ],
      confirmLabel: 'Berhenti',
      successMessage: `${bill.name} dihentikan`,
    }, () => api.post(`/bills/${bill.id}/stop`));
  },

  resumeBill(bill) {
    this.askConfirm({
      title: `Aktifkan lagi ${bill.name}?`,
      emoji: '1f504',
      tone: 'info',
      message: 'Tagihan kembali ke daftar aktif. Periode selama berhenti tidak ditagih; jatuh tempo berikutnya mulai dari hari ini.',
      details: [{ icon: 'coins', text: `${this.money(bill.amount)} · ${this.FREQUENCIES[bill.frequency]}` }],
      confirmLabel: 'Aktifkan',
      successMessage: `${bill.name} aktif lagi`,
    }, async () => { await api.post(`/bills/${bill.id}/resume`); this.billTab = 'active'; });
  },

  deleteBill(bill) {
    this.askConfirm({
      title: `Hapus permanen ${bill.name}?`,
      tone: 'danger',
      message: 'Tagihan dan riwayat periode yang dilewati dihapus. Pakai ini untuk tagihan yang salah input — untuk langganan yang diputus, cukup "Berhenti".',
      details: [
        { icon: 'coins', text: `${this.money(bill.amount)} · ${this.FREQUENCIES[bill.frequency]}` },
        { icon: 'check-circle', text: 'Transaksi pembayarannya tetap ada di Transaksi' },
      ],
      confirmLabel: 'Hapus permanen',
      successMessage: 'Tagihan dihapus',
    }, () => api.delete(`/bills/${bill.id}`));
  },
};
