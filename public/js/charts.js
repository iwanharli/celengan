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

// Grafik hanya digambar kalau kanvasnya sudah terlihat (punya ukuran). Saat periode berganti, area grafik
// bisa sesaat tersembunyi (x-show); menggambar di saat itu menghasilkan grafik 0×0 yang tidak muncul lagi.
// Jadi tunggu beberapa frame sampai terlihat. Permintaan baru untuk grafik yang sama membatalkan yang lama.
const waiting = {};
function draw(canvas, key, config, attempt = 0) {
  cancelAnimationFrame(waiting[key]);
  if (!canvas) return;
  if (!canvas.isConnected || canvas.parentElement.offsetWidth === 0) {
    if (attempt < 60) waiting[key] = requestAnimationFrame(() => draw(canvas, key, config, attempt + 1));
    return;
  }
  charts[key]?.destroy();
  charts[key] = new Chart(canvas, config);
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
        // Satu kategori saja → tanpa celah, supaya cincinnya utuh.
        borderWidth: used.length > 1 ? 3 : 0,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
        borderRadius: used.length > 1 ? 8 : 0,
        spacing: used.length > 1 ? 2 : 0,
        hoverOffset: 8,
      }],
    },
    options: {
      cutout: '74%',
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => ` ${item.label}: ${rupiah(item.raw)}` } },
      },
    },
  });
}

// Isi batang dengan gradasi lembut dari atas ke bawah.
const gradient = (top, bottom) => (context) => {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return top;
  const fill = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  return fill;
};

export function drawTrendChart(canvas, trend) {
  draw(canvas, 'trend', {
    data: {
      labels: trend.map((row) => shortMonthLabel(row.month)),
      datasets: [
        {
          type: 'line', label: 'Selisih', data: trend.map((row) => row.income - row.expense),
          borderColor: '#a78bfa', borderWidth: 2.5, borderDash: [6, 5], tension: .35,
          pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: '#a78bfa', pointBorderWidth: 2.5, order: 0,
        },
        {
          type: 'bar', label: 'Pemasukan', data: trend.map((row) => row.income),
          backgroundColor: gradient('#34d399', 'rgba(110, 231, 183, .35)'),
          borderRadius: 10, borderSkipped: false, maxBarThickness: 26, categoryPercentage: .6, barPercentage: .85, order: 1,
        },
        {
          type: 'bar', label: 'Pengeluaran', data: trend.map((row) => row.expense),
          backgroundColor: gradient('#fb7185', 'rgba(253, 164, 175, .35)'),
          borderRadius: 10, borderSkipped: false, maxBarThickness: 26, categoryPercentage: .6, barPercentage: .85, order: 1,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: textColor() } },
        y: {
          border: { display: false },
          ticks: { color: textColor(), callback: rupiahShort, maxTicksLimit: 5, padding: 8 },
          grid: { color: 'rgba(128,128,128,.12)', drawTicks: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          padding: 12, boxPadding: 6, usePointStyle: true,
          callbacks: { label: (item) => ` ${item.dataset.label}: ${rupiah(item.raw)}` },
        },
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
