import { api } from '../api.js';
import { drawYearChart } from '../charts.js';

// Halaman Laporan: ringkasan satu tahun kalender.
export default {
  report: null,
  reportYear: new Date().getFullYear(),

  async loadReport(year = this.reportYear) {
    this.reportYear = Number(year);
    this.report = await api.get(`/reports/yearly?year=${this.reportYear}`);
    this.$nextTick(() => drawYearChart(this.$refs.yearChart, this.report.months));
  },

  // "+12%" / "−5%" dibanding tahun lalu. lowerIsBetter: untuk pengeluaran, turun = bagus.
  changeBadge(percent, lowerIsBetter = false) {
    if (percent === null || percent === undefined) return null;
    const good = lowerIsBetter ? percent <= 0 : percent >= 0;
    return { text: `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}% vs ${this.reportYear - 1}`, tone: good ? 'ok' : 'danger' };
  },

  printReport() {
    window.print();
  },
};
