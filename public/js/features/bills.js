import { api } from '../api.js';
import { formatDate, daysUntil, formatAmountInput, todayISO } from '../format.js';

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
};

const PER_MONTH = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

// Halaman Tagihan: tagihan rutin, bayar, lewati, tambah & edit.
export default {
  billTab: 'active',
  // Label tanggal tagihan: merah = sudah lewat jatuh tempo, oranye = jatuh tempo bulan ini
  // (atau ≤ 7 hari lagi walau sudah masuk bulan depan), selain itu netral.
  // text = label singkat (dipakai di Beranda), relative = selalu waktu relatif (halaman Tagihan).
  billStatus(bill) {
    const days = daysUntil(bill.next_due);
    const relative = days < 0 ? `Telat ${-days} hari` : days === 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`;
    if (days < 0) return { text: relative, relative, tone: 'danger' };
    const short = this.billShortfall(bill);
    if (short && days <= 7) return { text: `Saldo kurang ${this.money(short)}`, relative: `${relative} · saldo kurang`, tone: 'danger' };
    if (days <= 3) return { text: relative, relative, tone: 'warning' };
    const thisMonth = bill.next_due.slice(0, 7) === todayISO().slice(0, 7);
    return { text: formatDate(bill.next_due), relative, tone: thisMonth || days <= 7 ? 'warning' : 'neutral' };
  },

  // Kekurangan saldo akun pembayar untuk tagihan ini (0 kalau cukup / tanpa akun).
  billShortfall(bill) {
    if (bill.account_balance == null) return 0;
    return Math.max(0, bill.amount - bill.account_balance);
  },

  // Peringatan saldo kurang: tagihan jatuh tempo ≤ 7 hari (atau telat) sementara saldo akunnya tidak cukup.
  billWarning(bill) {
    const short = this.billShortfall(bill);
    return short && daysUntil(bill.next_due) <= 7 ? `Saldo ${bill.account_name} kurang ${this.money(short)}` : '';
  },

  // "2026-11-09" → "Nov"
  monthShort(iso) {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { month: 'short' }).replace('.', '');
  },

  // Halaman Tagihan: Telat · Bulan ini · lalu per bulan berikutnya (urut jatuh tempo).
  get billGroups() {
    const today = todayISO();
    const groups = new Map();
    for (const bill of [...this.bills].sort((a, b) => a.next_due.localeCompare(b.next_due))) {
      const late = bill.next_due < today;
      const month = bill.next_due.slice(0, 7);
      const key = late ? 'late' : month === today.slice(0, 7) ? 'now' : month;
      if (!groups.has(key)) {
        const label = key === 'late' ? 'Telat / belum terbayar' : key === 'now' ? 'Bulan ini'
          : new Date(`${month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        groups.set(key, { key, label, tone: key === 'late' ? 'negative' : key === 'now' ? 'warning' : 'muted', items: [] });
      }
      groups.get(key).items.push(bill);
    }
    const order = (key) => (key === 'late' ? '0' : key === 'now' ? '1' : key);
    return [...groups.values()].sort((a, b) => order(a.key).localeCompare(order(b.key)));
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
      : { frequency: 'monthly', category_id: this.categoriesOf('expense')[0]?.id, account_id: this.defaultAccountId });
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
