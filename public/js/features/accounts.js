import { api } from '../api.js';
import { parseAmount, formatAmountInput, todayISO } from '../format.js';

// Rupiah boleh negatif (mis. saldo kartu kredit): "-500rb" → -500000
const parseSignedAmount = (text) => {
  const raw = String(text ?? '').trim();
  return raw.startsWith('-') ? -parseAmount(raw.slice(1)) : parseAmount(raw);
};

// "1234567890" → "1234 5678 90" (dibagi per 4 angka supaya mudah dibaca)
const groupDigits = (number) => number.replace(/(\d{4})(?=\d)/g, '$1 ');

// Halaman Akun (dompet, bank, e-wallet).
export default {
  revealedAccounts: {}, // id akun → nomor sedang ditampilkan

  // Akun dikelompokkan per jenis (Bank, E-Wallet, Tunai) dengan subtotal & porsi dari total.
  accountTab: 'all',

  goToAccountTab(tab) {
    this.accountTab = tab;
    history.replaceState(null, '', tab === 'all' ? '#accounts' : `#accounts/${tab}`);
  },

  get visibleAccountGroups() {
    return this.accountTab === 'all' ? this.accountGroups : this.accountGroups.filter((group) => group.type === this.accountTab);
  },

  get currentAccountGroup() {
    return this.accountGroups.find((group) => group.type === this.accountTab) ?? null;
  },

  get currentAccountTotal() {
    return this.accountTab === 'all' ? this.accountsTotal : this.currentAccountGroup?.subtotal ?? 0;
  },

  get accountGroups() {
    const total = this.accountsTotal;
    return ['bank', 'ewallet', 'emoney', 'cash', 'goal']
      .map((type) => {
        const items = this.accounts.filter((account) => account.type === type);
        const subtotal = items.reduce((sum, account) => sum + account.balance, 0);
        return { type, items, subtotal, percent: total > 0 ? Math.max(0, Math.round((subtotal / total) * 100)) : 0 };
      })
      .filter((group) => group.items.length);
  },

  get accountsTotal() {
    return this.accounts.reduce((sum, account) => sum + account.balance, 0);
  },

  accountShare(account) {
    return this.accountsTotal > 0 && account.balance > 0 ? Math.round((account.balance / this.accountsTotal) * 100) : 0;
  },

  // Nomor rekening/HP disamarkan: "•••• 4521". Ikut tersembunyi saat mode sembunyikan nominal.
  accountNumberText(account) {
    if (!account.account_number) return '';
    if (this.revealedAccounts[account.id] && !this.hideAmounts) return groupDigits(account.account_number);
    return `•••• ${account.account_number.slice(-4)}`;
  },

  toggleAccountNumber(account) {
    this.revealedAccounts = { ...this.revealedAccounts, [account.id]: !this.revealedAccounts[account.id] };
  },

  async copyAccountNumber(account) {
    try {
      await navigator.clipboard.writeText(account.account_number);
      this.showToast(`Nomor ${account.provider || account.name} disalin`);
    } catch {
      this.showToast('Gagal menyalin, coba tampilkan lalu salin manual');
    }
  },

  // Tanpa argumen: akun baru. Dengan akun: edit semua detail & saldo awal.
  // type: jenis awal untuk akun baru (dari tab yang sedang dibuka).
  openAccount(account = null, type = 'bank') {
    this.open('account', account
      ? {
        id: account.id,
        name: account.name,
        type: account.type,
        amountText: formatAmountInput(account.initial_balance),
        provider: account.provider ?? '',
        account_number: account.account_number ? groupDigits(account.account_number) : '',
        holder_name: account.holder_name ?? '',
        note: account.note ?? '',
      }
      : {
        type, name: '', provider: '', account_number: '', holder_name: this.auth.name ?? '', note: '',
        asIncome: false, income_category_id: this.categoriesOf('income')[0]?.id ?? '', income_date: todayISO(),
      });
  },

  saveAccount() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      // Nama boleh kosong: pakai nama bank/e-wallet (misal "BCA").
      const name = this.form.name?.trim() || this.form.provider?.trim();
      if (!name) throw new Error('Isi nama akun atau pilih bank/e-wallet');
      const body = {
        name,
        type: this.form.type,
        initial_balance: parseSignedAmount(this.form.amountText),
        provider: this.form.provider,
        account_number: this.form.account_number,
        holder_name: this.form.holder_name,
        note: this.form.note,
      };
      if (isNew && this.form.asIncome) {
        if (!(body.initial_balance > 0)) throw new Error('Saldo awal harus lebih dari 0 untuk dicatat sebagai pemasukan');
        body.income = { category_id: Number(this.form.income_category_id), date: this.form.income_date };
      }
      if (isNew) await api.post('/accounts', body);
      else await api.put(`/accounts/${this.form.id}`, body);
    }, isNew ? 'Akun ditambahkan' : 'Akun diperbarui');
  },

  deleteAccount(account) {
    const count = account.transaction_count;
    this.askConfirm({
      title: `Hapus akun ${account.name}?`,
      emoji: '1f45b',
      message: count
        ? 'Akun beserta semua transaksinya dihapus permanen.'
        : 'Akun ini belum punya transaksi, aman untuk dihapus.',
      details: [
        { icon: 'wallet', text: `Saldo sekarang ${this.money(account.balance)}` },
        { icon: 'list-bullets', text: `${count} transaksi tercatat` },
      ],
      warning: count
        ? `${count} transaksi ikut terhapus, termasuk transfer dari/ke akun ini. Laporan bulan-bulan lalu akan berubah. Kalau akun sudah tidak dipakai, lebih aman sesuaikan saldonya ke 0 saja.`
        : null,
      requireCheck: count > 0,
      successMessage: 'Akun dihapus',
    }, () => api.delete(`/accounts/${account.id}`));
  },

  async setPrimaryAccount(account) {
    try {
      await api.put(`/accounts/${account.id}/primary`, { primary: !account.is_primary });
      this.showToast(account.is_primary ? 'Tanda akun utama dilepas' : `⭐ ${account.name} jadi akun utama`);
      await this.reload();
    } catch (error) {
      this.showToast(error.message);
    }
  },

  openAdjust(account) {
    this.open('adjust', { account, amountText: formatAmountInput(account.balance), record_as: 'adjustment', category_id: '' });
  },

  saveAdjust() {
    return this.submit(async () => {
      await api.post(`/accounts/${this.form.account.id}/adjust`, {
        actual_balance: parseSignedAmount(this.form.amountText),
        record_as: this.form.record_as,
        category_id: Number(this.form.category_id) || null,
      });
    }, 'Saldo disesuaikan');
  },
};
