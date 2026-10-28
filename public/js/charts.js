import { Chart, registerables } from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';
import { rupiah, rupiahShort, shortMonthLabel } from './format.js';

Chart.register(...registerables);
Chart.defaults.font.family = "'Nunito', system-ui, sans-serif";
Chart.defaults.font.weight = 600;
Chart.defaults.animation.duration = 1100;
Chart.defaults.animation.easing = 'easeOutBack';
Chart.defaults.font.size = 15;

// Instance chart disimpan di luar state Alpine agar tidak dibungkus Proxy.
const charts = {};

function draw(canvas, key, config) {
  charts[key]?.destroy();
  if (canvas) charts[key] = new Chart(canvas, config);
}

const textColor = () => getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();

export function drawCategoryChart(canvas, categories) {
  const used = categories.filter((category) => category.spent > 0);
  draw(canvas, 'category', {
    type: 'doughnut',
    data: {
      labels: used.map((category) => category.name),
      datasets: [{
        data: used.map((category) => category.spent),
        backgroundColor: used.map((category) => category.color),
        borderWidth: 4,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
        borderRadius: 10,
        hoverOffset: 12,
      }],
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => ` ${item.label}: ${rupiah(item.raw)}` } },
      },
    },
  });
}

export function drawTrendChart(canvas, trend) {
  draw(canvas, 'trend', {
    type: 'bar',
    data: {
      labels: trend.map((row) => shortMonthLabel(row.month)),
      datasets: [
        { label: 'Pemasukan', data: trend.map((row) => row.income), backgroundColor: '#6ee7b7', borderRadius: 12, borderSkipped: false },
        { label: 'Pengeluaran', data: trend.map((row) => row.expense), backgroundColor: '#fda4af', borderRadius: 12, borderSkipped: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor() } },
        y: { ticks: { color: textColor(), callback: rupiahShort }, grid: { color: 'rgba(128,128,128,.15)' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor(), usePointStyle: true, padding: 20 } },
        tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${rupiah(item.raw)}` } },
      },
    },
  });
}

export function drawNetWorthChart(canvas, history) {
  draw(canvas, 'netWorth', {
    type: 'line',
    data: {
      labels: history.map((row) => shortMonthLabel(row.month)),
      datasets: [{
        label: 'Kekayaan bersih',
        data: history.map((row) => row.value),
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, .2)',
        fill: true,
        tension: .35,
        pointBackgroundColor: '#f9a8d4', pointBorderColor: '#fff', pointBorderWidth: 3, pointRadius: 7,
      }],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor() } },
        y: { ticks: { color: textColor(), callback: rupiahShort }, grid: { color: 'rgba(128,128,128,.15)' } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => ` ${rupiah(item.raw)}` } },
      },
    },
  });
}

// Laporan tahunan: batang pemasukan & pengeluaran per bulan + garis tabungan (selisihnya).
export function drawYearChart(canvas, months) {
  draw(canvas, 'year', {
    data: {
      labels: months.map((row) => shortMonthLabel(row.month)),
      datasets: [
        {
          type: 'line', label: 'Tabungan', data: months.map((row) => (row.future ? null : row.net)),
          borderColor: '#a78bfa', backgroundColor: '#a78bfa', tension: .35,
          pointRadius: 5, pointBackgroundColor: '#fff', pointBorderWidth: 3, order: 0,
        },
        { type: 'bar', label: 'Pemasukan', data: months.map((row) => row.income), backgroundColor: '#6ee7b7', borderRadius: 10, borderSkipped: false, order: 1 },
        { type: 'bar', label: 'Pengeluaran', data: months.map((row) => row.expense), backgroundColor: '#fda4af', borderRadius: 10, borderSkipped: false, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor() } },
        y: { ticks: { color: textColor(), callback: rupiahShort }, grid: { color: 'rgba(128,128,128,.15)' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor(), usePointStyle: true, padding: 20 } },
        tooltip: { callbacks: { label: (item) => ` ${item.dataset.label}: ${rupiah(item.raw)}` } },
      },
    },
  });
}
