import { api } from '../api.js';
import { currentMonth, formatDate } from '../format.js';
import { SETTINGS_SECTIONS } from '../constants.js';
import { TAX_METHODS, PTKP, annualTax } from '../tax-calc.js';
import { rupiahShort } from '../format.js';

// Halaman Pengaturan: jenis penghasilan, pajak, status backup otomatis, keamanan, mulai dari nol.
export default {
  incomeMode: 'fixed',
  settingsForm: { month_start_day: 1, income_mode: 'fixed', tax_rate: 0, tax_category_ids: [], tax_method: 'flat', tax_norma: '', tax_ptkp: 'TK/0' },
  TAX_METHODS,
  PTKP,
  taxPreviewGross: 120000000,
  autoBackups: [],
  backupMirror: null,
  mirrorDirInput: '',
  settingsSection: 'income',

  // Pajak hanya tampil di sub-menu saat mode freelance.
  get settingsSections() {
    return SETTINGS_SECTIONS.filter((section) => !section.freelanceOnly || this.settingsForm.income_mode === 'freelance');
  },

  goToSettings(section) {
    this.settingsSection = section;
    if (this.page !== 'settings') this.goTo('settings');
    history.replaceState(null, '', `#settings/${section}`);
    if (section === 'data') { this.loadAutoBackups(); this.loadBackupMirror(); }
    if (section === 'notify') this.loadPushState();
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
        tax_method: this.settingsForm.tax_method,
        tax_norma: this.settingsForm.tax_norma === '' || this.settingsForm.tax_norma == null
          ? null : Number(String(this.settingsForm.tax_norma).replace(',', '.')),
        tax_ptkp: this.settingsForm.tax_ptkp,
        emergency_months: Number(this.settingsForm.emergency_months) || 6,
      }));
      this.month = currentMonth(this.monthStartDay);
      this.range = null;
      this.showToast('Pengaturan disimpan');
      await this.reload();
    } catch (error) {
      this.showToast(error.message);
    }
  },

  // "TK/1" → "Lajang, 1 tanggungan"
  ptkpLabel(code) {
    const [status, dependents] = code.split('/');
    return `${status === 'K' ? 'Menikah' : 'Lajang'}, ${dependents === '0' ? 'tanpa tanggungan' : `${dependents} tanggungan`}`;
  },

  rupiahShortLabel(amount) {
    return `Rp${rupiahShort(amount)}`;
  },

  // Contoh hitungan pajak setahun dengan pengaturan yang sedang diisi.
  get taxPreview() {
    const form = this.settingsForm;
    const settings = {
      method: form.tax_method,
      rate: Number(String(form.tax_rate).replace(',', '.')) || 0,
      norma: Number(String(form.tax_norma ?? '').replace(',', '.')) || 0,
      ptkp: form.tax_ptkp,
    };
    if (settings.method === 'nppn' && !settings.norma) return null;
    const tax = annualTax(this.taxPreviewGross, settings);
    return { tax, rate: String(Math.round((tax / this.taxPreviewGross) * 1000) / 10).replace('.', ',') };
  },

  toggleTaxCategory(id) {
    const ids = this.settingsForm.tax_category_ids;
    this.settingsForm.tax_category_ids = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  },

  // ---------- Backup ----------

  async loadBackupMirror() {
    try {
      this.backupMirror = await api.get('/backup/mirror');
      if (!this.mirrorDirInput) this.mirrorDirInput = this.backupMirror.suggestions[0]?.path ?? '';
    } catch {}
  },

  async saveBackupMirror() {
    try {
      this.backupMirror = { ...(await api.put('/backup/mirror', { dir: this.mirrorDirInput })), suggestions: this.backupMirror.suggestions };
      if (this.backupMirror.error) this.formError = `Folder tersimpan, tapi menyalin gagal: ${this.backupMirror.error}`;
      else this.showToast('☁️ Backup disalin ke folder cloud');
      this.loadAutoBackups();
    } catch (error) {
      this.formError = error.message;
    }
  },

  stopBackupMirror() {
    this.askConfirm({
      title: 'Matikan salinan ke cloud?',
      tone: 'warning',
      message: 'Backup berikutnya hanya disimpan di komputer ini. File yang sudah tersalin tidak dihapus.',
      confirmLabel: 'Matikan',
      successMessage: 'Salinan ke cloud dimatikan',
    }, async () => { await api.delete('/backup/mirror'); this.backupMirror = null; await this.loadBackupMirror(); });
  },

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
