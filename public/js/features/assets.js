import { api } from '../api.js';
import { parseAmount, formatAmountInput } from '../format.js';

// Halaman Aset: daftar aset, nilai sekarang, beli/jual, dan kekayaan bersih.
export default {
  assetGain(asset) {
    return asset.current_value - asset.invested;
  },

  assetGainPercent(asset) {
    return asset.invested ? Math.round((this.assetGain(asset) / asset.invested) * 1000) / 10 : 0;
  },

  // Tanpa argumen: aset baru. Dengan aset: edit detailnya.
  openAsset(asset = null) {
    this.open('asset', asset
      ? { id: asset.id, name: asset.name, type: asset.type, amountText: formatAmountInput(asset.initial_cost), note: asset.note ?? '' }
      : { type: 'gold', name: '', note: '' });
  },

  saveAsset() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      if (!this.form.name?.trim()) throw new Error('Nama aset wajib diisi');
      const cost = parseAmount(this.form.amountText);
      const body = { name: this.form.name, type: this.form.type, initial_cost: cost, note: this.form.note };
      if (isNew) await api.post('/assets', { ...body, current_value: parseAmount(this.form.valueText) || cost });
      else await api.put(`/assets/${this.form.id}`, body);
    }, isNew ? 'Aset ditambahkan' : 'Aset diperbarui');
  },

  deleteAsset(asset) {
    const count = asset.transaction_count;
    this.askConfirm({
      title: `Hapus aset ${asset.name}?`,
      emoji: '1f48e',
      message: 'Aset dihapus dari daftar dan kekayaan bersih.',
      details: [
        { icon: 'chart-line-up', text: `Nilai sekarang ${this.money(asset.current_value)} · modal ${this.money(asset.invested)}` },
        { icon: 'list-bullets', text: `${count} transaksi beli/jual` },
      ],
      warning: count
        ? `${count} transaksi beli/jual ikut terhapus, jadi saldo akun berubah. Kalau asetnya sudah dijual, lebih baik pakai tombol Jual.`
        : null,
      requireCheck: count > 0,
      successMessage: 'Aset dihapus',
    }, () => api.delete(`/assets/${asset.id}`));
  },

  openAssetValue(asset) {
    this.open('assetValue', { asset, amountText: formatAmountInput(asset.current_value) });
  },

  saveAssetValue() {
    return this.submit(async () => {
      await api.put(`/assets/${this.form.asset.id}/value`, { current_value: parseAmount(this.form.amountText) });
    }, 'Nilai aset diperbarui');
  },

  openAssetTrade(asset, action) {
    this.open('assetTrade', { asset, action });
  },

  saveAssetTrade() {
    return this.submit(async () => {
      await api.post(`/assets/${this.form.asset.id}/${this.form.action}`, {
        amount: this.requireAmount(),
        account_id: Number(this.form.account_id),
        date: this.form.date,
      });
    }, this.form.action === 'buy' ? 'Pembelian tercatat' : 'Penjualan tercatat');
  },
};
