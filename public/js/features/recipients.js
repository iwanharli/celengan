import { api } from '../api.js';
import { formatAmountInput, formatDate } from '../format.js';

// Penerima: buku rekening tujuan kiriman (orang tua, keluarga, teman, ...).
// Kiriman dicatat sebagai pengeluaran dengan recipient_id, plus biaya admin (opsional).
const groupDigits = (number) => number.replace(/(\d{4})(?=\d)/g, '$1 ');

export default {
  recipientFilter: 'all',

  get filteredRecipients() {
    if (this.recipientFilter === 'all') return this.recipients;
    if (this.recipientFilter === 'favorite') return this.recipients.filter((r) => r.is_favorite);
    return this.recipients.filter((r) => r.relation === this.recipientFilter);
  },

  get recipientsMonthTotal() {
    return this.recipients.reduce((sum, r) => sum + r.month_sent, 0);
  },

  get selectedRecipient() {
    return this.recipients.find((r) => r.id == this.form.recipient_id) ?? null;
  },

  recipientInitials(recipient) {
    return recipient.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  },

  // "BCA · 1234 5678 90 · a.n. Budi"
  recipientDestination(recipient) {
    if (recipient.method === 'cash') return 'Diberikan tunai';
    const number = recipient.account_number && (this.hideAmounts ? `•••• ${recipient.account_number.slice(-4)}` : groupDigits(recipient.account_number));
    return [recipient.provider, number, recipient.holder_name && `a.n. ${recipient.holder_name}`].filter(Boolean).join(' · ');
  },

  async copyRecipientNumber(recipient) {
    try {
      await navigator.clipboard.writeText(recipient.account_number);
      this.showToast(`📋 Nomor ${recipient.name} disalin`);
    } catch {
      this.showToast('Gagal menyalin nomor');
    }
  },

  openRecipient(recipient = null) {
    const parentCategory = this.categoriesOf('expense').find((c) => c.name === 'Kiriman orang tua');
    this.open('recipient', recipient
      ? { ...recipient, category_id: recipient.category_id ?? '', account_number: recipient.account_number ?? '' }
      : { name: '', relation: 'parent', method: 'bank', provider: '', account_number: '', holder_name: '',
        category_id: parentCategory?.id ?? '', note: '', is_favorite: false });
  },

  // Hubungan "Orang tua" → kategori Kiriman orang tua (kalau kategorinya belum dipilih manual).
  pickRecipientRelation(relation) {
    this.form.relation = relation;
    if (relation === 'parent' && !this.form.category_id) {
      this.form.category_id = this.categoriesOf('expense').find((c) => c.name === 'Kiriman orang tua')?.id ?? '';
    }
  },

  saveRecipient() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      if (!this.form.name?.trim()) throw new Error('Isi nama penerima');
      const body = { ...this.form, category_id: Number(this.form.category_id) || null };
      if (isNew) await api.post('/recipients', body);
      else await api.put(`/recipients/${this.form.id}`, body);
    }, isNew ? `${this.form.name} ditambahkan ke Penerima` : 'Penerima diperbarui');
  },

  async toggleRecipientFavorite(recipient) {
    await api.put(`/recipients/${recipient.id}/favorite`);
    this.recipients = await api.get('/recipients');
  },

  deleteRecipient(recipient) {
    this.askConfirm({
      title: `Hapus ${recipient.name} dari Penerima?`,
      message: 'Detail rekeningnya dihapus. Riwayat kirimannya tetap ada sebagai pengeluaran biasa.',
      details: [
        { icon: 'user', text: this.RECIPIENT_RELATIONS[recipient.relation].label },
        { icon: 'paper-plane-tilt', text: `${recipient.sent_count}× kiriman · ${this.money(recipient.total_sent)}` },
      ],
      successMessage: 'Penerima dihapus',
    }, () => api.delete(`/recipients/${recipient.id}`));
  },

  // Tombol "Kirim": form pengeluaran yang sudah terisi penerima, kategori, akun & biaya terakhir.
  sendToRecipient(recipient) {
    this.openTransaction('expense', {
      recipient_id: recipient.id,
      category_id: recipient.category_id ?? '',
      account_id: recipient.last_account_id ?? this.defaultAccountId,
      amountText: recipient.last_amount ? formatAmountInput(recipient.last_amount) : '',
      feeText: recipient.last_fee ? formatAmountInput(recipient.last_fee) : '',
      note: `Kirim ke ${recipient.name}`,
    });
  },

  // Dipilih dari form pengeluaran: isi kategori & biaya terakhir penerima itu.
  pickRecipient() {
    const recipient = this.selectedRecipient;
    if (!recipient) { this.form.feeText = ''; return; }
    if (recipient.category_id) this.form.category_id = recipient.category_id;
    if (!this.form.feeText && recipient.last_fee) this.form.feeText = formatAmountInput(recipient.last_fee);
    if (!this.form.note) this.form.note = `Kirim ke ${recipient.name}`;
  },

  async openRecipientHistory(recipient) {
    this.open('recipientHistory', { recipient, history: null });
    this.form.history = await api.get(`/recipients/${recipient.id}/history`);
  },

  recipientLastText(recipient) {
    return recipient.last_date ? `Terakhir ${formatDate(recipient.last_date)} · ${this.money(recipient.last_amount)}` : 'Belum pernah dikirimi';
  },
};
