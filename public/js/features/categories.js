import { api } from '../api.js';
import { COLOR_CHOICES } from '../constants.js';
import { formatDate } from '../format.js';

// Halaman Kategori: daftar per jenis + pemakaian, tambah/edit, arsip, hapus atau gabungkan.
export default {
  categoryTab: 'expense',
  showArchived: false,

  // Urutan dari server (paling sering dipakai); arsip & "Lainnya" / "Pemasukan Lain" di akhir.
  get categoryList() {
    const list = this.categories.filter((category) =>
      category.kind === this.categoryTab && (this.showArchived || !category.archived));
    const last = (category) => (category.archived ? 2 : ['Lainnya', 'Pemasukan Lain'].includes(category.name) ? 1 : 0);
    return list.map((category, index) => ({ category, index }))
      .sort((a, b) => last(a.category) - last(b.category) || a.index - b.index)
      .map(({ category }) => category);
  },

  get archivedCount() {
    return this.categories.filter((category) => category.kind === this.categoryTab && category.archived).length;
  },

  categoryUsageText(category) {
    if (!category.usage_count) return 'Belum pernah dipakai';
    return `${category.usage_count} transaksi · ${this.money(category.usage_total)} · terakhir ${formatDate(category.last_used)}`;
  },

  openCategory(category = null) {
    this.open('category', category
      ? { id: category.id, name: category.name, kind: category.kind, icon: category.icon, color: category.color }
      : { name: '', kind: this.categoryTab, icon: 'tag', color: COLOR_CHOICES[6] });
  },

  saveCategory() {
    return this.submit(async () => {
      if (!this.form.name?.trim()) throw new Error('Nama kategori wajib diisi');
      const body = { name: this.form.name.trim(), kind: this.form.kind, icon: this.form.icon, color: this.form.color };
      if (this.form.id) await api.put(`/categories/${this.form.id}`, body);
      else await api.post('/categories', body);
    }, 'Kategori disimpan');
  },

  toggleArchive(category) {
    const archive = !category.archived;
    this.askConfirm({
      title: archive ? `Arsipkan ${category.name}?` : `Aktifkan lagi ${category.name}?`,
      emoji: '1f5c4-fe0f',
      tone: 'info',
      message: archive
        ? 'Kategori tidak muncul lagi di form transaksi. Riwayat, anggaran & laporan tetap utuh, dan bisa diaktifkan lagi kapan saja.'
        : 'Kategori muncul lagi di form transaksi.',
      details: [{ icon: 'list-bullets', text: this.categoryUsageText(category) }],
      confirmLabel: archive ? 'Arsipkan' : 'Aktifkan',
      successMessage: archive ? 'Kategori diarsipkan' : 'Kategori aktif lagi',
    }, () => api.put(`/categories/${category.id}/archive`, { archived: archive }));
  },

  // Kategori yang sudah dipakai (transaksi, tagihan, atau dihitung pajak) tidak bisa dihapus begitu saja.
  categoryInUse(category) {
    const taxed = this.isFreelance && this.settingsForm.tax_category_ids?.includes(category.id);
    return Boolean(category.usage_count || category.bill_count || taxed);
  },

  openCategoryDelete(category) {
    const others = this.categories.filter((item) => item.kind === category.kind && item.id !== category.id && !item.archived);
    const fallback = others.find((item) => ['Lainnya', 'Pemasukan Lain'].includes(item.name)) ?? others[0];
    this.open('categoryDelete', {
      category,
      inUse: this.categoryInUse(category),
      mode: 'merge', // merge | archive | new
      into: fallback?.id ?? '',
      newName: '',
      newIcon: category.icon,
      newColor: category.color,
    });
  },

  // Ringkasan apa saja yang akan pindah, untuk ditampilkan sebelum konfirmasi.
  get categoryMovePreview() {
    const { category, mode, into, newName } = this.form;
    if (!category) return '';
    const target = mode === 'new' ? newName.trim() || 'kategori baru' : this.categories.find((item) => item.id === Number(into))?.name;
    const parts = [];
    if (category.usage_count) parts.push(`${category.usage_count} transaksi (${this.money(category.usage_total)})`);
    if (category.bill_count) parts.push(`${category.bill_count} tagihan`);
    if (category.monthly_budget) parts.push(`anggaran ${this.money(category.monthly_budget)}`);
    return `${parts.join(', ') || 'Pengaturannya'} akan pindah ke "${target}", lalu "${category.name}" dihapus.`;
  },

  deleteCategory() {
    const { category, inUse, mode, into, newName, newIcon, newColor } = this.form;
    if (!inUse) {
      return this.submit(() => api.post(`/categories/${category.id}/delete`, {}), 'Kategori dihapus');
    }
    if (mode === 'archive') {
      return this.submit(() => api.put(`/categories/${category.id}/archive`, { archived: true }), `"${category.name}" diarsipkan`);
    }
    return this.submit(async () => {
      if (mode === 'merge' && !into) throw new Error('Pilih kategori tujuan');
      if (mode === 'new' && !newName.trim()) throw new Error('Isi nama kategori baru');
      const body = mode === 'new' ? { newCategory: { name: newName, icon: newIcon, color: newColor } } : { into: Number(into) };
      const { target } = await api.post(`/categories/${category.id}/delete`, body);
      this.form.doneMessage = `"${category.name}" dipindah ke "${target.name}". Backup pengaman disimpan.`;
    }, () => this.form.doneMessage);
  },
};
