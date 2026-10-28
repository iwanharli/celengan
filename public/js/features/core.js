import { api } from '../api.js';
import { celebrate, celebrateBig, emojiUrl } from '../effects.js';
import { showWarning } from '../alert.js';
import { drawCategoryChart, drawTrendChart, drawNetWorthChart, drawYearChart } from '../charts.js';
import {
  rupiah, rupiahShort, parseAmount, formatAmountInput, formatDate, formatMonthYear, monthLabel, daysUntil, todayISO, shiftMonth, currentMonth,
  addDays, daysBetween, formatRange,
} from '../format.js';
import * as constants from '../constants.js';

// Inti aplikasi: data, navigasi, helper tampilan, dan pola form/modal yang dipakai semua halaman.
// Sumber data (dipanggil dengan this = komponen Alpine).
const DATA_SOURCES = {
  summary() { return `/summary?${new URLSearchParams(this.periodParams)}`; },
  accounts: () => '/accounts',
  categories: () => '/categories',
  templates: () => '/templates',
  transactions() { return `/transactions?${new URLSearchParams({ ...this.periodParams, ...this.filters })}`; },
  bills: () => '/bills',
  debts: () => '/debts',
  assets: () => '/assets',
  wishlist: () => '/wishlist',
};
// Data tambahan per halaman (selain data dasar).
const PAGE_DATA = {
  home: ['bills', 'debts', 'wishlist'],
  transactions: ['transactions'],
  bills: ['bills'],
  debts: ['debts'],
  assets: ['assets'],
  wishlist: ['wishlist'],
};

export default {
  ...constants,
  emojiUrl, rupiah, parseAmount, formatAmountInput, formatDate, formatRange,
  EXPORT_DATASETS: constants.EXPORT_DATASETS, formatMonthYear, monthLabel, daysUntil,

  page: 'home',
  month: '',     // periode bulanan 'YYYY-MM' (mengikuti tanggal gajian)
  range: null,   // atau rentang bebas { start, end } (tanggal akhir ikut dihitung)
  monthStartDay: 1,

  summary: null,
  accounts: [],
  categories: [],
  transactions: [],
  bills: [],
  debts: [],
  wishlist: [],
  templates: [],
  staleData: null,
  assets: { assets: [], netWorth: null, history: [] },

  modal: null, // nama form yang sedang terbuka
  form: {},
  formError: '',
  toast: '',
  toastAction: null,
  hideAmounts: false,
  sidebarCollapsed: false,

  async init() {
    try {
      this.hideAmounts = localStorage.getItem('hideAmounts') === '1';
      this.sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === '1';
    } catch {}
    // Semua peringatan form tampil sebagai SweetAlert, bukan teks merah di bawah form.
    const titles = { formError: 'Ups, belum bisa disimpan', authError: 'Gagal masuk', exportError: 'Export gagal' };
    for (const [key, title] of Object.entries(titles)) {
      this.$watch(key, (message) => {
        if (!message) return;
        showWarning(message, title).then(() => { this[key] = ''; });
      });
    }
    window.addEventListener('auth:required', () => {
      this.auth.loggedIn = false;
      this.modal = null;
    });
    await this.checkAuth();
  },

  // ---------- Pemuatan data ----------

  async loadApp() {
    this.applySettings(await api.get('/settings'));
    this.month = currentMonth(this.monthStartDay);
    // Halaman aktif disimpan di URL (#assets) supaya tetap sama setelah refresh.
    const [fromHash, section] = location.hash.slice(1).split('/');
    if (constants.PAGES.some((item) => item.id === fromHash)) this.page = fromHash;
    if (fromHash === 'settings' && constants.SETTINGS_SECTIONS.some((item) => item.id === section)) this.settingsSection = section;
    await this.reload();
  },

  // Memuat ulang data setelah ada perubahan. Supaya hemat, yang dimuat hanya:
  //   - data dasar yang dipakai di mana-mana (ringkasan, akun, kategori, favorit), dan
  //   - data milik halaman yang sedang dibuka (lihat PAGE_DATA).
  // Data halaman lain ditandai "basi" dan baru dimuat saat halamannya dibuka.
  async reload() {
    this.staleData = new Set(Object.keys(DATA_SOURCES));
    await Promise.all([
      this.loadData(['summary', 'accounts', 'categories', 'templates']),
      this.loadPageData(),
    ]);
    if (this.page === 'settings') this.loadAutoBackups();
    if (this.page === 'reports') await this.loadReport();
    if (this.page === 'export') this.refreshExportPreview();
    this.$nextTick(() => this.drawCharts());
  },

  async loadData(keys) {
    const results = await Promise.all(keys.map((key) => api.get(DATA_SOURCES[key].call(this))));
    keys.forEach((key, index) => {
      this[key] = results[index];
      this.staleData?.delete(key);
    });
  },

  // Data halaman aktif yang belum dimuat / sudah basi.
  async loadPageData() {
    const needed = (PAGE_DATA[this.page] ?? []).filter((key) => this.staleData?.has(key));
    if (needed.length) await this.loadData(needed);
  },

  drawCharts() {
    if (!this.summary) return;
    if (this.page === 'home') {
      drawCategoryChart(this.$refs.categoryChart, this.summary.categories);
      drawTrendChart(this.$refs.trendChart, this.summary.trend);
    }
    if (this.page === 'assets') {
      drawNetWorthChart(this.$refs.netWorthChart, this.assets.history);
    }
    if (this.page === 'reports' && this.report) {
      drawYearChart(this.$refs.yearChart, this.report.months);
    }
  },

  // ---------- Navigasi ----------

  async goTo(page) {
    this.page = page;
    this.loadPageData().then(() => this.$nextTick(() => this.drawCharts()));
    history.replaceState(null, '', page === 'settings' ? `#settings/${this.settingsSection}` : `#${page}`);
    window.scrollTo({ top: 0 });
    if (page === 'settings') this.loadAutoBackups();
    if (page === 'reports') this.loadReport();
    if (page === 'export') this.initExport();
    this.$nextTick(() => this.drawCharts());
  },

  // ‹ › di topbar: geser satu bulan, atau sepanjang rentang yang dipilih.
  shiftPeriod(step) {
    if (this.range) {
      const days = daysBetween(this.range.start, this.range.end) + 1;
      this.range = { start: addDays(this.range.start, step * days), end: addDays(this.range.end, step * days) };
    } else {
      this.month = shiftMonth(this.month, step);
    }
    this.reload();
  },

  // Parameter periode untuk API: ?month=… atau ?start=…&end=…
  get periodParams() {
    return this.range ? { start: this.range.start, end: this.range.end } : { month: this.month };
  },


  // Label utama di topbar: "Oktober 2026" atau "1 Agu – 28 Okt 2026".
  get periodLabel() {
    if (!this.range) return monthLabel(this.month);
    return formatRange(this.range.start, this.range.end);
  },

  get periodText() {
    if (this.range) return `${daysBetween(this.range.start, this.range.end) + 1} hari`;
    if (!this.summary) return '';
    const { start, end } = this.summary.period;
    const lastDay = new Date(`${end}T00:00:00`);
    lastDay.setDate(lastDay.getDate() - 1);
    return `${formatDate(start)} – ${formatDate(lastDay.toLocaleDateString('sv-SE'))}`;
  },

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed ? '1' : '0'); } catch {}
    // Grafik perlu diukur ulang setelah lebar konten berubah.
    setTimeout(() => this.drawCharts(), 320);
  },

  // ---------- Helper tampilan ----------

  money(amount) {
    return this.hideAmounts ? 'Rp ●●●●●' : rupiah(amount);
  },

  // Versi ringkas untuk ringkasan grafik: "Rp 4,1 jt"
  moneyShort(amount) {
    return this.hideAmounts ? 'Rp ●●●' : `Rp ${rupiahShort(amount)}`;
  },

  toggleHideAmounts() {
    this.hideAmounts = !this.hideAmounts;
    try { localStorage.setItem('hideAmounts', this.hideAmounts ? '1' : '0'); } catch {}
  },

  // Item menu per kelompok (lihat NAV_GROUPS di constants.js).
  navItems(group) {
    return group.pages.map((id) => constants.PAGES.find((page) => page.id === id));
  },

  // Kategori untuk form: aktif saja, urut dari yang paling sering dipakai (diurutkan server).
  // Kategori arsip tetap muncul bila sedang dipakai oleh data yang diedit.
  // Akun bawaan untuk semua form: akun utama, kalau belum ada pakai akun pertama.
  get defaultAccountId() {
    const regular = this.regularAccounts;
    return (regular.find((account) => account.is_primary) ?? regular[0])?.id ?? '';
  },

  // Akun biasa (bank, e-wallet, tunai) — tanpa akun tabungan impian.
  get regularAccounts() {
    return this.accounts.filter((account) => account.type !== 'goal');
  },

  categoriesOf(kind) {
    const selected = Number(this.form?.category_id);
    return this.categories.filter((category) => category.kind === kind && (!category.archived || category.id === selected));
  },

  // ---------- Form & modal ----------

  open(modal, values = {}) {
    this.modal = modal;
    this.formError = '';
    this.form = { amountText: '', date: todayISO(), account_id: this.defaultAccountId, ...values };
    this.$nextTick(() => document.querySelector('.modal [autofocus]')?.focus());
  },

  close() {
    this.modal = null;
  },

  get parsedAmount() {
    return parseAmount(this.form.amountText);
  },

  requireAmount() {
    if (this.parsedAmount <= 0) throw new Error('Nominal belum diisi atau tidak valid');
    return this.parsedAmount;
  },

  // Semua form dikirim lewat sini supaya penanganan error & toast seragam.
  // celebration: null, 'small' (konfeti) atau 'big' (konfeti dari dua sisi).
  async submit(action, successMessage, celebration = null) {
    this.formError = '';
    try {
      await action();
      const message = typeof successMessage === 'function' ? successMessage() : successMessage;
      this.close();
      this.showToast(message);
      if (celebration === 'small') celebrate();
      if (celebration === 'big') celebrateBig();
      if (this.auth.loggedIn) await this.reload(); // tidak perlu memuat data setelah keluar
    } catch (error) {
      this.formError = error.message;
    }
  },

  // ---------- Modal konfirmasi (pengganti dialog konfirmasi bawaan browser) ----------
  // options:
  //   title, message      judul & penjelasan
  //   emoji               kode Fluent Emoji (default tempat sampah)
  //   tone                'danger' | 'warning' | 'info' → warna tombol & aksen
  //   details             [{ icon, text }] ringkasan data yang terkena
  //   warning             teks peringatan dampak (kotak kuning)
  //   requireCheck        wajib centang "saya mengerti" (untuk aksi yang menghapus banyak data)
  //   confirmLabel, successMessage, celebration
  askConfirm(options, action) {
    this.open('confirm', {
      tone: 'danger',
      emoji: '1f5d1-fe0f',
      confirmLabel: 'Ya, hapus',
      details: [],
      requireCheck: false,
      ...options,
      checked: false,
      action,
    });
  },

  runConfirm() {
    const { action, successMessage, celebration = null } = this.form;
    return this.submit(async () => {
      if (this.form.requireCheck && !this.form.checked) throw new Error('Centang dulu "Saya mengerti" untuk melanjutkan');
      await action();
    }, successMessage, celebration);
  },

  apiPost(path, body) {
    return api.post(path, body);
  },

  // action (opsional): { label, run } → tombol di toast, misal "Batalkan".
  showToast(message, action = null) {
    this.toast = message;
    this.toastAction = action;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = ''; this.toastAction = null; }, action ? 5000 : 2500);
  },

  async runToastAction() {
    const action = this.toastAction;
    this.toast = '';
    this.toastAction = null;
    await action?.run();
  },
};
