import { currentMonth, shiftMonth, addDays, todayISO, monthLabel } from '../format.js';

// Modal "Pilih periode": pilihan cepat, per bulan, atau rentang tanggal bebas.
const firstOfMonth = (month) => `${month}-01`;
const lastOfMonth = (month) => addDays(firstOfMonth(shiftMonth(month, 1)), -1);

export default {
  openPeriodPicker() {
    const year = Number((this.range?.end ?? this.month).slice(0, 4));
    this.open('period', {
      tab: this.range ? 'range' : 'month',
      year,
      start: this.range?.start ?? '',
      end: this.range?.end ?? '',
    });
  },

  // Pilihan cepat. Yang berbasis bulan memakai periode gajian; sisanya rentang tanggal.
  get periodPresets() {
    const today = todayISO();
    const month = currentMonth(this.monthStartDay);
    const thisYear = today.slice(0, 4);
    const calendarMonth = today.slice(0, 7);
    return [
      { key: 'this-month', label: 'Bulan ini', icon: 'calendar-check', month },
      { key: 'last-month', label: 'Bulan lalu', icon: 'calendar-minus', month: shiftMonth(month, -1) },
      { key: '7d', label: '7 hari terakhir', icon: 'calendar-dots', start: addDays(today, -6), end: today },
      { key: '30d', label: '30 hari terakhir', icon: 'calendar-dots', start: addDays(today, -29), end: today },
      { key: '3m', label: '3 bulan terakhir', icon: 'calendar-blank', start: firstOfMonth(shiftMonth(calendarMonth, -2)), end: today },
      { key: '6m', label: '6 bulan terakhir', icon: 'calendar-blank', start: firstOfMonth(shiftMonth(calendarMonth, -5)), end: today },
      { key: 'this-year', label: 'Tahun ini', icon: 'calendar-star', start: `${thisYear}-01-01`, end: `${thisYear}-12-31` },
      { key: 'last-year', label: 'Tahun lalu', icon: 'calendar-star', start: `${thisYear - 1}-01-01`, end: `${thisYear - 1}-12-31` },
    ];
  },

  isPresetActive(preset) {
    if (preset.month) return !this.range && this.month === preset.month;
    return this.range?.start === preset.start && this.range?.end === preset.end;
  },

  // Bulan dalam satu tahun untuk tab "Per bulan".
  periodMonths(year) {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      return { month, label: monthLabel(month).split(' ')[0], future: month > currentMonth(this.monthStartDay) };
    });
  },

  // Terapkan: { month } untuk periode bulanan, { start, end } untuk rentang.
  applyPeriod(period) {
    if (period.month) {
      this.month = period.month;
      this.range = null;
    } else {
      this.range = { start: period.start, end: period.end };
      this.month = period.end.slice(0, 7);
    }
    this.close();
    this.reload();
  },

  applyCustomRange() {
    if (!this.form.start || !this.form.end) {
      this.formError = 'Pilih tanggal awal dan tanggal akhir di kalender';
      return;
    }
    this.applyPeriod({ start: this.form.start, end: this.form.end });
  },

  get customRangeDays() {
    if (!this.form.start || !this.form.end) return 0;
    return Math.round((new Date(`${this.form.end}T00:00:00`) - new Date(`${this.form.start}T00:00:00`)) / 86400000) + 1;
  },

  firstOfMonth,
  lastOfMonth,
};
