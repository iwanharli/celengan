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
      ? { id: asset.id, name: asset.name, type: asset.type, amountText: formatAmountInput(asset.initial_cost), note: asset.note ?? '', wallet_address: asset.wallet_address ?? '' }
      : { type: 'gold', name: '', note: '', wallet_address: '' });
  },

  saveAsset() {
    const isNew = !this.form.id;
    return this.submit(async () => {
      if (!this.form.name?.trim()) throw new Error('Nama aset wajib diisi');
      const cost = parseAmount(this.form.amountText);
      const body = { name: this.form.name, type: this.form.type, initial_cost: cost, note: this.form.note, wallet_address: this.form.wallet_address };
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

  // Wallet Solana: token bernilai dulu, token tanpa harga di belakang.
  walletTokens(asset) {
    return asset.wallet_tokens?.tokens ?? [];
  },

  walletSyncText(asset) {
    if (!asset.synced_at) return asset.sync_error ? 'Belum berhasil diperbarui' : 'Belum diperbarui';
    const time = new Date(asset.synced_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `Diperbarui ${time}`;
  },

  // "$0.001917", "$99.86", "$1,234"
  formatUsd(value) {
    if (value == null) return '–';
    const digits = value >= 100 ? 0 : value >= 1 ? 2 : Math.min(8, 2 - Math.floor(Math.log10(value)) + 1);
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits });
  },

  changeText(change) {
    return change == null ? '' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`;
  },

  // Porsi nilai: token di wallet vs posisi LP (persen).
  walletSplit(asset) {
    const lp = (asset.wallet_tokens?.positions ?? []).reduce((sum, p) => sum + p.value, 0);
    const total = asset.current_value || 1;
    return { lp: Math.round((lp / total) * 100), wallet: 100 - Math.round((lp / total) * 100) };
  },

  // Rentang harga LP dalam USD (harga bin × harga USD token kedua) + posisi penanda harga sekarang (0–100%).
  lpRange(lp) {
    const range = lp.range;
    const quoteUsd = lp.tokens[1]?.usd_price;
    if (!range || !quoteUsd) return null;
    const marker = ((range.current - range.lower) / (range.upper - range.lower)) * 100;
    return {
      lower: range.lower * quoteUsd, upper: range.upper * quoteUsd, current: range.current * quoteUsd,
      inRange: range.in_range, marker: Math.max(0, Math.min(100, marker)),
    };
  },

  formatTokenAmount(amount) {
    return amount.toLocaleString('id-ID', { maximumFractionDigits: amount < 1 ? 6 : amount < 1000 ? 4 : 0 });
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
