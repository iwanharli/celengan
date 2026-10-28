import { api } from '../api.js';
import { currentMonth, formatDate } from '../format.js';
import { SETTINGS_SECTIONS } from '../constants.js';

// Halaman Pengaturan: jenis penghasilan, pajak, status backup otomatis, keamanan, mulai dari nol.
export default {
  incomeMode: 'fixed',
  settingsForm: { month_start_day: 1, income_mode: 'fixed', tax_rate: 0, tax_category_ids: [] },
  autoBackups: [],
  settingsSection: 'income',

  // Pajak hanya tampil di sub-menu saat mode freelance.
  get settingsSections() {
    return SETTINGS_SECTIONS.filter((section) => !section.freelanceOnly || this.settingsForm.income_mode === 'freelance');
  },

  goToSettings(section) {
    this.settingsSection = section;
    if (this.page !== 'settings') this.goTo('settings');
    history.replaceState(null, '', `#settings/${section}`);
    if (section === 'data') this.loadAutoBackups();
  },

  get isFreelance() {
    return this.incomeMode === 'freelance';
  },

  applySettings(settings) {
    this.monthStartDay = settings.month_start_day;
    this.incomeMode = settings.income_mode;
    this.settingsForm = { ...settings };
  },

  async saveSettings() {
    try {
      this.applySettings(await api.put('/settings', {
        month_start_day: Number(this.settingsForm.month_start_day),
        income_mode: this.settingsForm.income_mode,
        tax_rate: Number(String(this.settingsForm.tax_rate).replace(',', '.')) || 0,
        tax_category_ids: this.settingsForm.tax_category_ids,
      }));
      this.month = currentMonth(this.monthStartDay);
      this.range = null;
      this.showToast('Pengaturan disimpan');
      await this.reload();
    } catch (error) {
      this.showToast(error.message);
    }
  },

  toggleTaxCategory(id) {
    const ids = this.settingsForm.tax_category_ids;
    this.settingsForm.tax_category_ids = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  },

  // ---------- Backup ----------

  async loadAutoBackups() {
    try {
      this.autoBackups = await api.get('/backup/auto');
    } catch {
      this.autoBackups = [];
    }
  },

  // "auto-2026-10-28.json" → "Harian · 28 Okt 2026"
  // "sebelum-gabung-kategori-kopi-20261028-143005.json" → "Sebelum gabung kategori kopi · 28 Okt 2026"
  backupLabel(file) {
    const date = formatDate(new Date(file.created_at).toLocaleDateString('sv-SE'));
    if (file.kind === 'daily') return `Harian · ${date}`;
    const action = file.name.replace(/^sebelum-/, '').replace(/-\d{8}-\d{6}\.json$/, '').replace(/-/g, ' ');
    return `Sebelum ${action} · ${date}`;
  },

  // Backup otomatis terakhir, untuk status di Pengaturan → Data.
  get lastAutoBackup() {
    return this.autoBackups[0] ?? null;
  },

  openReset() {
    this.open('reset', { confirmText: '' });
  },

  resetAllData() {
    return this.submit(async () => {
      await api.post('/backup/reset', { confirm: this.form.confirmText.trim() });
    }, 'Semua data dihapus. Selamat mulai dari nol! ✨');
  },
};
