import { api } from '../api.js';
import { COOLDOWN_DAYS, WISH_KINDS } from '../constants.js';
import { wishTargetStatus } from '../wish-progress.js';
import { formatMonthYear, addMonths, daysUntil, todayISO, formatAmountInput, parseAmount } from '../format.js';

// Halaman Wishlist: barang yang diinginkan, sudah terbeli, dan dibatalkan — lengkap dengan riwayatnya.
export default {
  wishTab: 'wanted',

  wishItems(status) {
    return this.wishlist.filter((item) => item.status === status);
  },

  get wishStats() {
    const wanted = this.wishItems('wanted');
    return {
      total: wanted.reduce((sum, item) => sum + item.price, 0),
      saved: wanted.reduce((sum, item) => sum + item.saved, 0),
      collected: wanted.reduce((sum, item) => sum + item.saved + (item.paid_total ?? 0), 0),
      counts: {
        wanted: wanted.length,
        bought: this.wishItems('bought').length,
        cancelled: this.wishItems('cancelled').length,
      },
    };
  },

  // Rencana per barang: progres, kapan terbeli dengan kecepatan menabung sekarang,
  // berapa per bulan untuk mengejar target tanggal, dan sisa masa tahan 30 hari.
  // Terkumpul = uang yang disisihkan + yang sudah dibayar lewat rincian (misal DP gedung).
  wishPlan(item) {
    const collected = item.saved + (item.paid_total ?? 0);
    const remaining = Math.max(0, item.price - collected);
    const percent = Math.min(100, Math.round((collected / item.price) * 100));
    const monthlySavings = this.summary?.savings?.estimate ?? 0;

    let eta = null;
    if (remaining === 0) eta = 'Dana sudah cukup!';
    else if (monthlySavings > 0) {
      const months = Math.ceil(remaining / monthlySavings);
      eta = months <= 1 ? 'Bisa tercapai bulan ini' : `Bisa tercapai ±${months} bulan lagi (${formatMonthYear(addMonths(todayISO(), months))})`;
    }

    const target = wishTargetStatus({ ...item, saved: collected }, todayISO());
    const age = -daysUntil(new Date(item.created_at).toLocaleDateString('sv-SE'));
    // Masa tahan 30 hari hanya untuk barang (bukan pernikahan, dana darurat, dll.).
    const cooldownLeft = item.kind === 'item' ? Math.max(0, COOLDOWN_DAYS - age) : 0;
    const partsTotal = (item.parts ?? []).reduce((sum, part) => sum + part.amount, 0);
    return { collected, remaining, percent, eta, target, cooldownLeft, partsTotal, unallocated: item.price - partsTotal };
  },

  wishDoneLabel(item) {
    return WISH_KINDS[item.kind]?.done ?? 'Tercapai';
  },

  // Teks status target untuk kartu wishlist.
  wishTargetText(item, target) {
    const when = formatMonthYear(item.target_date);
    switch (target.level) {
      case 'ahead': return `Lebih cepat ${this.money(target.gap)} dari rencana. Target ${when} aman!`;
      case 'on_track': return `Sesuai jalur menuju target ${when}. Pertahankan ${this.money(target.perMonth)}/bulan.`;
      case 'behind': return `Tertinggal ${this.money(-target.gap)} dari rencana. Sisihkan ${this.money(target.perMonth)}/bulan supaya tetap ${when}.`;
      default: return `Target ${when} sudah lewat ${target.daysLate} hari, masih kurang ${this.money(target.remaining)}. Ubah target atau tambah sisihan.`;
    }
  },

  // ---------- Form ----------

  openWish(item = null, kind = 'item') {
    const toRow = (part) => ({ id: part.id, name: part.name, amountText: formatAmountInput(part.amount), note: part.note ?? '', paid: part.paid ?? 0 });
    this.open('wish', item
      ? {
        ...item,
        amountText: formatAmountInput(item.price),
        target_date: item.target_date ?? '',
        link: item.link ?? '',
        note: item.note ?? '',
        parts: item.parts.map(toRow),
        showParts: item.parts.length > 0,
      }
      : {
        name: '', amountText: '', priority: 'medium', kind, emoji: WISH_KINDS[kind].emoji,
        link: '', note: '', target_date: '', parts: [], showParts: kind !== 'item',
      });
  },

  // Ganti jenis impian: emoji ikut berganti kalau belum dipilih manual.
  setWishKind(kind) {
    const previous = WISH_KINDS[this.form.kind];
    if (!this.form.emoji || this.form.emoji === previous?.emoji) this.form.emoji = WISH_KINDS[kind].emoji;
    this.form.kind = kind;
    if (kind !== 'item' && this.form.parts.length === 0) this.form.showParts = true;
  },

  // ---------- Rincian biaya di form ----------

  addWishPart(name = '') {
    this.form.parts.push({ id: null, name, amountText: '', note: '', paid: 0 });
  },

  removeWishPart(index) {
    this.form.parts.splice(index, 1);
  },

  useWishTemplate() {
    WISH_KINDS[this.form.kind].template.forEach((name) => this.addWishPart(name));
  },

  get wishPartsSummary() {
    const total = this.form.parts.reduce((sum, part) => sum + parseAmount(part.amountText), 0);
    const target = parseAmount(this.form.amountText);
    return { total, target, unallocated: target - total };
  },

  fitWishTargetToParts() {
    this.form.amountText = formatAmountInput(this.wishPartsSummary.total);
  },

  saveWish() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      if (!this.form.name?.trim()) throw new Error('Nama wajib diisi');
      const parts = this.form.showParts
        ? this.form.parts
          .filter((part) => part.name.trim())
          .map((part) => ({ id: part.id, name: part.name, amount: parseAmount(part.amountText), note: part.note }))
        : [];
      // Target boleh kosong kalau ada rincian: pakai total rincian.
      const partsTotal = parts.reduce((sum, part) => sum + part.amount, 0);
      if (!this.parsedAmount && partsTotal) this.form.amountText = formatAmountInput(partsTotal);
      const body = {
        name: this.form.name,
        kind: this.form.kind,
        parts,
        price: this.requireAmount(),
        priority: this.form.priority,
        emoji: this.form.emoji,
        link: this.form.link,
        note: this.form.note,
        target_date: this.form.target_date || null,
      };
      if (isNew) await api.post('/wishlist', body);
      else await api.put(`/wishlist/${this.form.id}`, body);
    }, isNew ? 'Masuk wishlist ✨' : 'Wishlist diperbarui');
  },

  openWishSave(item) {
    // Bawaan: akun utama, kalau tidak ada pakai akun biasa dengan saldo terbesar.
    const regular = this.regularAccounts;
    const source = regular.find((a) => a.is_primary) ?? [...regular].sort((a, b) => b.balance - a.balance)[0];
    this.open('wishSave', { item, direction: 'add', amountText: '', account_id: source?.id ?? '' });
  },

  saveWishSave() {
    const amount = this.parsedAmount;
    const isAdd = this.form.direction === 'add';
    const reachesGoal = isAdd && this.form.item.saved + amount >= this.form.item.price;
    return this.submit(async () => {
      this.requireAmount();
      await api.post(`/wishlist/${this.form.item.id}/save`, { amount: isAdd ? amount : -amount, account_id: Number(this.form.account_id) });
    }, reachesGoal ? 'Dana sudah cukup! 🎉' : isAdd ? 'Uang disisihkan' : 'Uang diambil kembali', reachesGoal ? 'small' : null);
  },

  openWishBuy(item) {
    this.open('wishBuy', { item, amountText: formatAmountInput(item.price), category_id: this.categoriesOf('expense')[0]?.id });
  },

  buyWish() {
    return this.submit(async () => {
      if (!this.form.category_id) throw new Error('Pilih kategori pengeluaran');
      await api.post(`/wishlist/${this.form.item.id}/buy`, {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        category_id: Number(this.form.category_id),
        date: this.form.date,
      });
      this.wishTab = 'bought';
    }, 'Selamat menikmati barang barumu! 🎉', 'big');
  },

  // Tidak jadi beli / batalkan pembelian: minta alasan singkat (opsional) untuk riwayat.
  openWishStatus(item, action) {
    this.open('wishStatus', { item, action, reason: '' });
  },

  saveWishStatus() {
    const { item, action, reason } = this.form;
    const messages = { cancel: 'Dipindah ke Dibatalkan', unbuy: 'Pembelian dibatalkan, transaksinya dihapus' };
    return this.submit(async () => {
      await api.post(`/wishlist/${item.id}/${action}`, { reason });
      this.wishTab = 'wanted';
      if (action === 'cancel') this.wishTab = 'cancelled';
    }, messages[action]);
  },

  restoreWish(item) {
    this.askConfirm({
      title: `Ingin ${item.name} lagi?`,
      emoji: item.emoji,
      tone: 'info',
      message: 'Barang kembali ke tab Diinginkan. Uang yang disisihkan mulai lagi dari Rp 0.',
      confirmLabel: 'Ya, inginkan lagi',
      successMessage: 'Kembali ke daftar keinginan ✨',
    }, async () => {
      await api.post(`/wishlist/${item.id}/restore`);
      this.wishTab = 'wanted';
    });
  },

  deleteWish(item) {
    this.askConfirm({
      title: `Hapus ${item.name} permanen?`,
      emoji: item.emoji,
      message: 'Barang beserta seluruh riwayatnya dihapus dan tidak bisa dikembalikan.',
      details: [{ icon: 'clock-counter-clockwise', text: `${item.events.length} catatan riwayat` }],
      successMessage: 'Dihapus dari wishlist',
    }, () => api.delete(`/wishlist/${item.id}`));
  },

  // Bayar satu rincian (misal DP katering).
  openWishPartPay(item, part) {
    const lainnya = this.categoriesOf('expense').find((category) => category.name === 'Lainnya');
    this.open('wishPartPay', {
      item,
      part,
      amountText: formatAmountInput(Math.max(0, part.amount - part.paid)),
      category_id: lainnya?.id ?? this.categoriesOf('expense')[0]?.id,
      use_saved: item.saved > 0,
    });
  },

  payWishPart() {
    const { item, part } = this.form;
    const fullyPaid = part.paid + this.parsedAmount >= part.amount;
    return this.submit(async () => {
      if (!this.form.category_id) throw new Error('Pilih kategori pengeluaran');
      await api.post(`/wishlist/${item.id}/parts/${part.id}/pay`, {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        category_id: Number(this.form.category_id),
        date: this.form.date,
        use_saved: this.form.use_saved,
      });
    }, fullyPaid ? `${part.name} lunas! 🎉` : `Pembayaran ${part.name} tercatat`, fullyPaid ? 'small' : null);
  },

  // Impian non-barang: tandai tercapai tanpa transaksi pembelian.
  completeWish(item) {
    const plan = this.wishPlan(item);
    this.askConfirm({
      title: `${item.name} tercapai?`,
      emoji: '1f3c6',
      tone: 'info',
      message: 'Impian dipindah ke tab Terbeli / tercapai. Pembayaran rincian tetap tercatat di Transaksi.',
      details: [
        { icon: 'coins', text: `Terkumpul ${this.money(plan.collected)} dari ${this.money(item.price)}` },
        ...(item.parts.length ? [{ icon: 'receipt', text: `Sudah dibayar lewat rincian ${this.money(item.paid_total)}` }] : []),
      ],
      confirmLabel: 'Ya, tercapai!',
      successMessage: 'Selamat, impianmu tercapai! 🎉',
      celebration: 'big',
    }, async () => {
      await api.post(`/wishlist/${item.id}/complete`, {});
      this.wishTab = 'bought';
    });
  },

  openWishHistory(item) {
    this.open('wishHistory', { item });
  },
};
