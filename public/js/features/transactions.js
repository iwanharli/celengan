import { api } from '../api.js';
import { TRANSACTION_STYLE, EDITABLE_KINDS } from '../constants.js';
import { formatDate, formatAmountInput, parseAmount, rupiah } from '../format.js';
import { compressImage, formatFileSize } from '../photos.js';
import { addToDropzone, removeFromDropzone } from '../photo-dropzone.js';

const MAX_PHOTOS = 10;

const KIND_LABELS = {
  income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer', adjustment: 'Penyesuaian',
  debt_in: 'Utang masuk', debt_out: 'Utang keluar', asset_in: 'Jual aset', asset_out: 'Beli aset',
};
// Kolom yang ditampilkan di riwayat perubahan (kolom teknis seperti id tidak ditampilkan).
const HISTORY_FIELDS = {
  kind: 'Jenis', amount: 'Nominal', date: 'Tanggal', account_id: 'Akun', to_account_id: 'Ke akun',
  category_id: 'Kategori', note: 'Catatan', client: 'Klien',
};

// Kategori pemasukan yang berasal dari pekerjaan (punya klien, bisa dipotong PPh 21).
const WORK_INCOME_CATEGORIES = ['Freelance', 'Komisi', 'Usaha / Jualan'];

// Filter halaman Transaksi. min/max = nominal (angka), photos = '' | 'yes' | 'no', sort lihat SORTS di server.
const EMPTY_FILTERS = { kind: '', q: '', account_id: '', category_id: '', recipient_id: '', bill_id: '', min: '', max: '', photos: '', sort: 'newest' };

// Halaman Transaksi: daftar, filter, tambah & edit.
export default {
  filters: { ...EMPTY_FILTERS },
  clientNames: [],

  showTxFilters: false,

  // Filter di panel "Filter" (selain cari & jenis) yang sedang aktif.
  get extraFilterCount() {
    const f = this.filters;
    return [f.account_id, f.category_id, f.recipient_id, f.bill_id, f.min, f.max, f.photos, f.sort !== 'newest' && f.sort].filter(Boolean).length;
  },

  get hasFilters() {
    return Boolean(this.filters.kind || this.filters.q || this.extraFilterCount);
  },

  resetFilters() {
    this.filters = { ...EMPTY_FILTERS };
    this.reload();
  },

  style(transaction) {
    return TRANSACTION_STYLE[transaction.kind];
  },

  transactionTitle(t) {
    if (t.kind === 'transfer') return `Transfer ke ${t.to_account_name}`;
    if (t.kind === 'adjustment') return 'Penyesuaian saldo';
    if (t.debt_id) return t.note || t.debt_name;
    if (t.asset_id) return t.note || t.asset_name;
    return t.category_name ?? 'Tanpa kategori';
  },

  transactionSubtitle(t) {
    const parts = [t.account_name];
    if (t.note && !t.debt_id && !t.asset_id) parts.unshift(t.note);
    if (t.client && !t.debt_id) parts.unshift(t.client);
    return parts.join(' · ');
  },

  transactionAmount(t) {
    if (t.kind === 'adjustment') return `${t.amount > 0 ? '+' : '−'}${this.money(Math.abs(t.amount))}`;
    return `${this.style(t).sign}${this.money(t.amount)}`;
  },

  // Transaksi utang/aset/penyesuaian dibuat dari halamannya masing-masing, jadi tidak diedit di sini.
  isEditable(t) {
    return EDITABLE_KINDS.includes(t.kind);
  },

  deleteTransaction(t) {
    const effects = [];
    if (t.kind === 'transfer') effects.push('Saldo kedua akun kembali seperti sebelum transfer.');
    if (t.fee) effects.push(`Biaya admin ${rupiah(t.fee)} ikut terhapus.`);
    if (t.fee_of) effects.push('Ini biaya admin sebuah transfer; transfernya sendiri tetap ada.');
    if (t.debt_id) effects.push(`Ini terhubung ke utang/piutang "${t.debt_name}": sisa dan jadwal cicilannya ikut menyesuaikan.`);
    if (t.asset_id) effects.push(`Ini transaksi aset "${t.asset_name}": modal aset ikut berubah.`);
    if (t.bill_id) effects.push('Ini pembayaran tagihan: jatuh tempo tagihannya tidak mundur otomatis.');
    if (t.note?.startsWith('Wishlist:')) effects.push('Barang wishlist-nya kembali ke tab Diinginkan.');
    this.askConfirm({
      title: `Hapus "${this.transactionTitle(t)}"?`,
      message: 'Transaksi dihapus permanen dan saldo akun dihitung ulang.',
      details: [
        { icon: 'coins', text: this.transactionAmount(t) },
        { icon: 'calendar', text: formatDate(t.date) },
        { icon: 'wallet', text: t.to_account_name ? `${t.account_name} → ${t.to_account_name}` : t.account_name },
      ],
      warning: effects.join(' ') || null,
      successMessage: 'Transaksi dihapus',
    }, () => api.delete(`/transactions/${t.id}`));
  },

  // ---------- Edit: pintu masuk untuk semua jenis transaksi ----------
  // Pemasukan/pengeluaran/transfer → form lengkap. Utang/aset/penyesuaian → form terbatas
  // (nominal, akun, tanggal, catatan) karena jenis & keterkaitannya tidak boleh berubah.
  editTransaction(t) {
    if (this.isEditable(t)) this.openEditTransaction(t);
    else this.openLinkedEdit(t);
  },

  openLinkedEdit(t) {
    this.open('transactionLinked', {
      transaction: t,
      id: t.id,
      amountText: (t.amount < 0 ? '-' : '') + formatAmountInput(Math.abs(t.amount)),
      account_id: t.account_id,
      date: t.date,
      note: t.note ?? '',
      withheldText: t.tax_withheld ? formatAmountInput(t.tax_withheld) : '', // pembayaran invoice
    });
  },

  get linkedEditHint() {
    const t = this.form.transaction;
    if (!t) return '';
    if (t.debt_id) return `Terhubung ke "${t.debt_name}": sisa utang & jadwal cicilan ikut menyesuaikan.`;
    if (t.asset_id) return `Transaksi aset "${t.asset_name}": nilai aset ikut bergeser sebesar selisihnya.`;
    return 'Penyesuaian saldo: boleh minus (contoh -50rb).';
  },

  saveLinkedEdit() {
    return this.submit(async () => {
      const raw = String(this.form.amountText).trim();
      const amount = raw.startsWith('-') ? -parseAmount(raw.slice(1)) : parseAmount(raw);
      if (!amount) throw new Error('Nominal belum diisi atau tidak valid');
      await api.put(`/transactions/${this.form.id}`, {
        amount, account_id: Number(this.form.account_id), date: this.form.date, note: this.form.note,
        tax_withheld: this.form.transaction.kind === 'income' ? parseAmount(this.form.withheldText) || 0 : undefined,
      });
    }, 'Transaksi diperbarui');
  },

  // ---------- Riwayat perubahan ----------
  async openTransactionHistory(t) {
    this.open('transactionHistory', { transaction: t, history: null });
    this.form.history = await api.get(`/transactions/${t.id}/history`);
  },

  async openDeletedTransactions() {
    this.open('deletedTransactions', { items: null });
    this.form.items = await api.get('/transactions/history/deleted');
  },

  // "Nominal: Rp 25.000 → Rp 30.000" untuk satu perubahan.
  historyChangeText(field, [before, after]) {
    const label = HISTORY_FIELDS[field] ?? field;
    const show = (value) => {
      if (value === null || value === undefined || value === '') return '—';
      if (field === 'amount') return this.money(value);
      if (field === 'date') return formatDate(value);
      if (field === 'kind') return KIND_LABELS[value] ?? value;
      if (field === 'account_id' || field === 'to_account_id') return this.accounts.find((a) => a.id === value)?.name ?? `#${value}`;
      if (field === 'category_id') return this.categories.find((c) => c.id === value)?.name ?? `#${value}`;
      return String(value);
    };
    return { label, before: show(before), after: show(after) };
  },

  historyChanges(entry) {
    return Object.entries(entry.changes ?? {})
      .filter(([field]) => HISTORY_FIELDS[field])
      .map(([field, values]) => this.historyChangeText(field, values));
  },

  // ---------- Favorit ----------
  templateLabel(template) {
    return `${template.name} · ${this.money(template.amount)}`;
  },

  // Sekali klik: langsung tercatat hari ini, dengan tombol Batalkan di toast.
  // Catat cepat: buka form transaksi yang sudah terisi dari favorit (tanggal hari ini), tinggal cek & simpan.
  openFromTemplate(template) {
    this.openTransaction(template.kind);
    this.applyTemplate(template);
  },

  applyTemplate(template) {
    Object.assign(this.form, {
      kind: template.kind,
      amountText: formatAmountInput(template.amount),
      account_id: template.account_id,
      to_account_id: template.to_account_id ?? '',
      category_id: template.category_id ?? '',
      note: template.note ?? '',
    });
  },

  async saveAsTemplate() {
    try {
      const category = this.categories.find((c) => c.id === Number(this.form.category_id));
      const name = this.form.note?.trim() || category?.name || (this.form.kind === 'transfer' ? 'Transfer' : 'Favorit');
      await api.post('/templates', {
        name,
        kind: this.form.kind,
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        to_account_id: Number(this.form.to_account_id) || null,
        category_id: Number(this.form.category_id) || null,
        note: this.form.note,
      });
      this.templates = await api.get('/templates');
      this.showToast(`⭐ "${name}" disimpan sebagai favorit`);
    } catch (error) {
      this.formError = error.message;
    }
  },

  deleteTemplate(template) {
    this.askConfirm({
      title: `Hapus favorit ${template.name}?`,
      emoji: '2b50',
      tone: 'info',
      message: 'Hanya pintasannya yang dihapus — transaksi yang sudah dicatat tetap ada.',
      confirmLabel: 'Hapus favorit',
      successMessage: 'Favorit dihapus',
    }, () => api.delete(`/templates/${template.id}`));
  },

  openTransaction(kind = 'expense', values = {}) {
    this.open('transaction', {
      kind, category_id: '', to_account_id: '', note: '', client: '', feeText: '', recipient_id: '', withheldText: '', attachments: [], photos: [], ...values,
    });
    this.loadClientNames();
  },

  // Freelance: proyek yang langsung dibayar (tanpa invoice) = pemasukan kategori Freelance + nama klien.
  openPaidProject() {
    const freelance = this.categoriesOf('income').find((category) => category.name === 'Freelance');
    this.openTransaction('income', { category_id: freelance?.id ?? '', paidProject: true });
  },

  // Klien & potongan PPh 21 hanya untuk pemasukan dari pekerjaan: kategori kena pajak (Pengaturan → Pajak)
  // atau kategori kerja (Freelance, Komisi, Usaha). Tetap tampil kalau sudah terisi (saat edit).
  get incomeFromWork() {
    if (this.form.kind !== 'income' || !this.form.category_id) return false;
    const id = Number(this.form.category_id);
    if (this.summary?.tax?.categoryIds?.includes(id) || this.settingsForm.tax_category_ids?.includes(id)) return true;
    const name = this.categoriesOf('income').find((c) => c.id === id)?.name;
    return WORK_INCOME_CATEGORIES.includes(name);
  },

  // Biaya admin: selalu untuk transfer; untuk pengeluaran kalau ada penerima (non-tunai),
  // dibuka lewat "+ Biaya admin", atau sudah terisi (saat edit).
  get showFeeField() {
    if (this.form.kind === 'transfer') return true;
    if (this.form.kind !== 'expense') return false;
    return Boolean((this.form.recipient_id && this.selectedRecipient?.method !== 'cash') || this.form.showFee || parseAmount(this.form.feeText) > 0);
  },

  get showClientField() {
    return this.form.kind === 'income' && (this.incomeFromWork || Boolean(this.form.client));
  },

  get showWithheldField() {
    return this.form.kind === 'income' && this.isFreelance && (this.incomeFromWork || parseAmount(this.form.withheldText) > 0);
  },

  // Transfer baru: isi biaya admin dengan biaya terakhir untuk pasangan akun yang sama.
  async suggestTransferFee() {
    if (this.form.id || this.form.kind !== 'transfer' || !this.form.account_id || !this.form.to_account_id) return;
    try {
      const { fee } = await api.get(`/transactions/transfer-fee?from=${this.form.account_id}&to=${this.form.to_account_id}`);
      if (fee !== null) this.form.feeText = fee ? formatAmountInput(fee) : '';
    } catch {}
  },

  async loadClientNames() {
    try { this.clientNames = await api.get('/transactions/clients'); } catch {}
  },

  openEditTransaction(t) {
    if (!this.isEditable(t)) return;
    this.open('transaction', {
      id: t.id,
      kind: t.kind,
      amountText: formatAmountInput(t.amount),
      account_id: t.account_id,
      to_account_id: t.to_account_id ?? '',
      category_id: t.category_id ?? '',
      date: t.date,
      note: t.note ?? '',
      client: t.client ?? '',
      feeText: t.fee ? formatAmountInput(t.fee) : '',
      recipient_id: t.recipient_id ?? '',
      withheldText: t.tax_withheld ? formatAmountInput(t.tax_withheld) : '',
      linked_to: t.linked_to, // jenisnya dikunci bila terhubung ke utang/tagihan/wishlist
      attachments: t.attachments.map((photo) => ({ ...photo, removed: false })), // foto yang sudah ada
      photos: [], // foto baru yang belum diunggah
    });
    this.loadClientNames();
  },

  async saveTransaction() {
    const isNew = !this.form.id;
    if (this.form.kind !== 'income' && this.parsedAmount > 0) {
      const fee = parseAmount(this.form.feeText) || 0;
      // Saat edit dari akun yang sama, nominal lama dikembalikan dulu.
      const old = this.form.id ? this.transactions.find((t) => t.id === this.form.id) : null;
      const refund = old && old.kind !== 'income' && old.account_id === Number(this.form.account_id) ? old.amount + (old.fee ?? 0) : 0;
      if (!(await this.confirmEnoughBalance(this.form.account_id, this.parsedAmount + fee, refund))) return;
    }
    return this.submit(async () => {
      const { attachments, photos, ...fields } = this.form;
      const body = {
        ...fields,
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        to_account_id: Number(this.form.to_account_id) || null,
        category_id: Number(this.form.category_id) || null,
        recipient_id: this.form.kind === 'expense' ? Number(this.form.recipient_id) || null : null,
        tax_withheld: this.form.kind === 'income' ? parseAmount(this.form.withheldText) || 0 : 0,
        fee: this.showFeeField ? parseAmount(this.form.feeText) || 0 : 0,
      };
      if (this.form.id) await api.put(`/transactions/${this.form.id}`, body);
      // Simpan id-nya: kalau unggah foto gagal lalu dicoba lagi, transaksi tidak tercatat dua kali.
      else this.form.id = (await api.post('/transactions', body)).id;
      await this.syncPhotos();
    }, this.transactionSavedMessage(isNew), isNew && this.form.kind === 'income' ? 'small' : null);
  },

  // ---------- Foto / bukti ----------

  get photoCount() {
    return (this.form.attachments ?? []).filter((photo) => !photo.removed).length + (this.form.photos ?? []).length;
  },

  attachmentUrl(id) {
    return `/api/attachments/${id}`;
  },

  formatFileSize,

  // Tombol Kamera: foto dari kamera dimasukkan ke kotak unggah (FilePond).
  addCameraPhotos(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (this.photoCount + files.length > MAX_PHOTOS) this.showToast(`Maksimal ${MAX_PHOTOS} foto per transaksi`);
    addToDropzone(files.slice(0, Math.max(0, MAX_PHOTOS - this.photoCount)));
  },

  toggleAttachmentRemoval(photo) {
    photo.removed = !photo.removed;
  },

  // Setelah transaksi tersimpan: hapus foto yang ditandai, unggah foto baru satu per satu.
  async syncPhotos() {
    for (const photo of this.form.attachments.filter((item) => item.removed)) {
      await api.delete(`/attachments/${photo.id}`);
    }
    this.form.attachments = this.form.attachments.filter((item) => !item.removed);
    // Foto dikecilkan dulu di browser, lalu diunggah satu per satu.
    // Yang berhasil dikeluarkan dari kotak unggah, jadi "Simpan" ulang hanya mengunggah sisanya.
    const pending = [...this.form.photos];
    try {
      for (const [index, photo] of pending.entries()) {
        this.form.uploading = `Mengunggah foto ${index + 1} dari ${pending.length}…`;
        const saved = await api.upload(`/transactions/${this.form.id}/attachments`, await compressImage(photo.file));
        this.form.attachments.push({ id: saved.id, name: saved.original_name, removed: false });
        removeFromDropzone(photo.key);
      }
    } catch (error) {
      throw new Error(`Transaksi tersimpan, tapi foto gagal diunggah: ${error.message}. Tekan Simpan lagi untuk mencoba ulang.`);
    } finally {
      this.form.uploading = '';
    }
  },

  // Penampil foto (dari daftar transaksi).
  openPhotos(t, index = 0) {
    this.open('photos', { transaction: t, index });
  },

  shiftPhoto(step) {
    const total = this.form.transaction.attachments.length;
    this.form.index = (this.form.index + step + total) % total;
  },

  transactionSavedMessage(isNew) {
    if (!isNew) return 'Transaksi diperbarui';
    const tax = this.form.kind === 'income'
      ? this.taxShare(this.parsedAmount, this.form.category_id, parseAmount(this.form.withheldText) || 0) : 0;
    return tax ? `Tersimpan! Sisihkan ${this.money(tax)} untuk pajak 🧾` : 'Transaksi tersimpan';
  },
};
