import { EXPORT_DATASETS } from '../constants.js';

// Halaman Export: pilih data, periode, filter & format → pratinjau → unduh.
// Pengaturan diingat di browser (localStorage) untuk export berikutnya.
const STORAGE_KEY = 'exportSettings';

const DEFAULT_SETTINGS = {
  datasets: ['transactions'],
  period: 'current',        // current (ikut topbar) | all | custom
  start: '',
  end: '',
  kinds: [],                // kosong = semua jenis
  account_ids: [],
  category_ids: [],
  format: 'xlsx',           // xlsx | pdf | csv
  date_format: 'dmy',       // dmy (28/10/2026) | iso (2026-10-28)
  money_format: 'number',   // number (1500000) | rupiah (Rp 1.500.000)
  separator: ';',
};

export default {
  exportSettings: { ...DEFAULT_SETTINGS },
  exportPreview: null,
  exportLoading: false,
  exportError: '',

  initExport() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      if (saved) this.exportSettings = { ...DEFAULT_SETTINGS, ...saved };
    } catch {}
    this.refreshExportPreview();
  },

  saveExportSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.exportSettings)); } catch {}
  },

  // Isi permintaan ke server. "current" = periode yang sedang dipilih di topbar.
  get exportRequest() {
    return { ...this.exportSettings, current: this.periodParams, period_label: this.exportPeriodLabel };
  },

  get exportPeriodLabel() {
    const { period, start, end } = this.exportSettings;
    if (period === 'all') return 'Semua waktu';
    if (period === 'custom') return start && end ? this.formatRange(start, end) : 'Pilih tanggal';
    return this.periodLabel;
  },

  get hasTransactionsSelected() {
    return this.exportSettings.datasets.includes('transactions');
  },

  get exportTotalRows() {
    return (this.exportPreview ?? []).reduce((sum, item) => sum + item.count, 0);
  },

  toggleExportValue(field, value) {
    const list = this.exportSettings[field];
    this.exportSettings[field] = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    this.exportChanged();
  },

  selectAllDatasets(all) {
    this.exportSettings.datasets = all ? EXPORT_DATASETS.map((item) => item.key) : [];
    this.exportChanged();
  },

  resetExportSettings() {
    this.exportSettings = { ...DEFAULT_SETTINGS };
    this.exportChanged();
  },

  exportChanged() {
    this.saveExportSettings();
    clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => this.refreshExportPreview(), 300);
  },

  async refreshExportPreview() {
    this.exportError = '';
    if (!this.exportSettings.datasets.length) { this.exportPreview = []; return; }
    if (this.exportSettings.period === 'custom' && !(this.exportSettings.start && this.exportSettings.end)) return;
    try {
      this.exportPreview = await this.apiPost('/export/preview', this.exportRequest);
    } catch (error) {
      this.exportError = error.message;
    }
  },

  // Unduh: Excel/PDF = satu file berisi semua data; CSV = satu file per data.
  async downloadExport() {
    this.exportError = '';
    this.exportLoading = true;
    try {
      const requests = this.exportSettings.format === 'csv'
        ? this.exportSettings.datasets.map((dataset) => ({ ...this.exportRequest, dataset }))
        : [this.exportRequest];
      for (const body of requests) await this.downloadFile('/api/export/file', body);
      this.showToast(requests.length > 1 ? `${requests.length} file CSV diunduh` : 'File diunduh ✨');
    } catch (error) {
      this.exportError = error.message;
    } finally {
      this.exportLoading = false;
    }
  },

  async downloadFile(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Gagal membuat file');
    const name = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'celengan-export';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },
};
