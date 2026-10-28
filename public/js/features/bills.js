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
  billStatus(bill) {
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
      }
      : { frequency: 'monthly', category_id: this.categoriesOf('expense')[0]?.id });
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
      };
      if (isNew) await api.post('/bills', body);
      else await api.put(`/bills/${this.form.id}`, body);
    }, isNew ? 'Tagihan ditambahkan' : 'Tagihan diperbarui');
  },

  openPayBill(bill) {
    this.open('payBill', { bill, amountText: formatAmountInput(bill.amount), account_id: bill.account_id ?? this.accounts[0]?.id });
  },

  payBill() {
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

  skipBill(bill) {
    this.askConfirm({
      title: `Lewati ${bill.name} periode ini?`,
      emoji: '23ed-fe0f',
      tone: 'info',
      message: 'Tagihan periode ini dianggap tidak perlu dibayar. Tidak ada transaksi yang dicatat.',
      details: [
        { icon: 'calendar-x', text: `Jatuh tempo sekarang: ${formatDate(bill.next_due)}` },
        { icon: 'calendar-check', text: `Berikutnya: ${formatDate(this.nextDueAfter(bill))}` },
      ],
      confirmLabel: 'Lewati',
      successMessage: 'Tagihan dilewati',
    }, () => api.post(`/bills/${bill.id}/skip`));
  },

  deleteBill(bill) {
    this.askConfirm({
      title: `Hapus tagihan ${bill.name}?`,
      tone: 'warning',
      message: 'Pengingat untuk tagihan ini berhenti.',
      details: [
        { icon: 'coins', text: `${this.money(bill.amount)} · ${this.FREQUENCIES[bill.frequency]}` },
        { icon: 'check-circle', text: 'Riwayat pembayaran sebelumnya tetap ada di Transaksi' },
      ],
      successMessage: 'Tagihan dihapus',
    }, () => api.delete(`/bills/${bill.id}`));
  },
};
