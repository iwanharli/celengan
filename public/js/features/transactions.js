import { api } from '../api.js';
import { TRANSACTION_STYLE, EDITABLE_KINDS } from '../constants.js';
import { formatDate, formatAmountInput } from '../format.js';
import { compressImage, formatFileSize } from '../photos.js';
import { addToDropzone, removeFromDropzone } from '../photo-dropzone.js';

const MAX_PHOTOS = 10;

// Halaman Transaksi: daftar, filter, tambah & edit.
export default {
  filters: { kind: '', account_id: '', q: '' },
  clientNames: [],

  get hasFilters() {
    return Boolean(this.filters.kind || this.filters.account_id || this.filters.q);
  },

  resetFilters() {
    this.filters = { kind: '', account_id: '', q: '' };
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

  openTransaction(kind = 'expense', values = {}) {
    this.open('transaction', {
      kind, category_id: '', to_account_id: '', note: '', client: '', attachments: [], photos: [], ...values,
    });
    this.loadClientNames();
  },

  // Freelance: proyek yang langsung dibayar (tanpa invoice) = pemasukan kategori Freelance + nama klien.
  openPaidProject() {
    const freelance = this.categoriesOf('income').find((category) => category.name === 'Freelance');
    this.openTransaction('income', { category_id: freelance?.id ?? '', paidProject: true });
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
      linked_to: t.linked_to, // jenisnya dikunci bila terhubung ke utang/tagihan/wishlist
      attachments: t.attachments.map((photo) => ({ ...photo, removed: false })), // foto yang sudah ada
      photos: [], // foto baru yang belum diunggah
    });
    this.loadClientNames();
  },

  saveTransaction() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      const { attachments, photos, ...fields } = this.form;
      const body = {
        ...fields,
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        to_account_id: Number(this.form.to_account_id) || null,
        category_id: Number(this.form.category_id) || null,
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
    const tax = this.form.kind === 'income' ? this.taxShare(this.parsedAmount, this.form.category_id) : 0;
    return tax ? `Tersimpan! Sisihkan ${this.money(tax)} untuk pajak 🧾` : 'Transaksi tersimpan';
  },
};
