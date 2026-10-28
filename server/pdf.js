import PDFDocument from 'pdfkit';
import { createRequire } from 'node:module';
import { formatValue } from './exporter.js';

// PDF export bergaya Celengan: kepala bergradasi ungu-pink + celengan, kartu ringkasan pastel,
// tabel per data dengan baris belang, header tabel diulang tiap halaman, dan nomor halaman.
// A4 mendatar supaya tabel lebar tetap muat.

const require = createRequire(import.meta.url);
const FONTS = {
  body: require.resolve('@fontsource/nunito/files/nunito-latin-400-normal.woff'),
  bold: require.resolve('@fontsource/nunito/files/nunito-latin-800-normal.woff'),
  title: require.resolve('@fontsource/fredoka/files/fredoka-latin-600-normal.woff'),
  titleBold: require.resolve('@fontsource/fredoka/files/fredoka-latin-700-normal.woff'),
};

const COLOR = {
  text: '#2e2549', muted: '#776d93', primary: '#8b5cf6', pink: '#ec4899', border: '#ebe4fa',
  zebra: '#faf7ff', positive: '#059669', negative: '#e11d48',
};
// Warna kartu & penanda bagian, bergantian per data.
const PASTELS = [
  ['#efe8ff', '#8b5cf6'], ['#ffe4f1', '#ec4899'], ['#dcfce9', '#059669'], ['#fff3c4', '#b45309'],
  ['#e0f2fe', '#0284c7'], ['#ffe4e6', '#e11d48'],
];

const MARGIN = 36;
const ROW_HEIGHT = 21;
const HEADER_HEIGHT = 24;

// Lebar kolom menyesuaikan isi: diukur dari judul & nilai terpanjang, lalu diskalakan ke lebar halaman.
// Kolom teks yang panjang (catatan) dibatasi supaya kolom lain tetap lega.
const PADDING = 14;
function columnWidths(doc, columns, cells, available) {
  const natural = columns.map((column, index) => {
    doc.font('bold').fontSize(8.5);
    let width = doc.widthOfString(column.label);
    doc.font(column.type === 'money' ? 'bold' : 'body').fontSize(8.8);
    for (const row of cells) width = Math.max(width, doc.widthOfString(row[index]));
    const cap = column.type === 'text' ? 210 : 140;
    return Math.min(cap, Math.max(44, width + PADDING + 4)); // +4: cadangan pembulatan
  });
  const total = natural.reduce((a, b) => a + b, 0);
  // Sisa (atau kekurangan) ruang dibagi sebanding lebar tiap kolom, supaya jaraknya merata.
  return natural.map((width) => (width / total) * available);
}

const rupiah = (amount) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount).replace(/\s/g, ' ');

// Potong teks dengan "…" supaya muat di kolom.
function fit(doc, text, width) {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.widthOfString(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

// Celengan babi kecil dari bentuk dasar (PDF tidak bisa memuat emoji .webp).
function drawPiggy(doc, x, y, size) {
  const s = size / 40;
  doc.save();
  doc.circle(x + 20 * s, y + 21 * s, 16 * s).fill('#ffd6e8');
  doc.polygon([x + 9 * s, y + 9 * s], [x + 13 * s, y + 1 * s], [x + 17 * s, y + 8 * s]).fill('#ffb3d1');
  doc.polygon([x + 23 * s, y + 8 * s], [x + 27 * s, y + 1 * s], [x + 31 * s, y + 9 * s]).fill('#ffb3d1');
  doc.roundedRect(x + 13 * s, y + 22 * s, 14 * s, 9 * s, 4.5 * s).fill('#ff9ec4');
  doc.circle(x + 17.5 * s, y + 26.5 * s, 1.6 * s).fill('#c2185b');
  doc.circle(x + 22.5 * s, y + 26.5 * s, 1.6 * s).fill('#c2185b');
  doc.circle(x + 14 * s, y + 17 * s, 1.8 * s).fill(COLOR.text);
  doc.circle(x + 26 * s, y + 17 * s, 1.8 * s).fill(COLOR.text);
  doc.roundedRect(x + 16 * s, y + 4.5 * s, 8 * s, 2.5 * s, 1.2 * s).fill('#c2185b'); // celah koin
  doc.circle(x + 20 * s, y + 0 * s, 3.5 * s).fill('#fcd34d'); // koin
  doc.restore();
}

function drawHeader(doc, { title, subtitle, printedAt }) {
  const width = doc.page.width;
  const gradient = doc.linearGradient(0, 0, width, 0);
  gradient.stop(0, COLOR.primary).stop(0.6, '#c084fc').stop(1, COLOR.pink);
  doc.rect(0, 0, width, 108).fill(gradient);
  // titik-titik berkilau
  [[0.12, 22, 3], [0.45, 16, 2], [0.62, 84, 3.5], [0.85, 26, 2.5], [0.93, 70, 2]].forEach(([fx, y, r]) =>
    doc.circle(width * fx, y, r).fillOpacity(0.35).fill('#ffffff').fillOpacity(1));

  doc.roundedRect(MARGIN, 26, 56, 56, 18).fill('#ffffff');
  drawPiggy(doc, MARGIN + 8, 36, 40);

  doc.fillColor('#ffffff').font('titleBold').fontSize(26).text('Celengan', MARGIN + 72, 28);
  doc.font('bold').fontSize(11).fillOpacity(0.92).text(title, MARGIN + 72, 62);
  doc.font('body').fontSize(9.5).text(subtitle, MARGIN + 72, 78);
  doc.fillOpacity(1).font('body').fontSize(9).text(`Dicetak ${printedAt}`, MARGIN, 30, { width: width - MARGIN * 2, align: 'right' });
  doc.y = 128;
}

function drawSummaryCards(doc, cards) {
  const gap = 12;
  const width = (doc.page.width - MARGIN * 2 - gap * (cards.length - 1)) / cards.length;
  const top = doc.y;
  cards.forEach((card, index) => {
    const x = MARGIN + index * (width + gap);
    const [background, accent] = card.colors;
    doc.roundedRect(x, top, width, 62, 16).fill(background);
    doc.circle(x + width - 18, top + 18, 6).fill(accent);
    doc.fillColor(COLOR.muted).font('bold').fontSize(8.5).text(card.label.toUpperCase(), x + 14, top + 12, { characterSpacing: 0.6 });
    doc.fillColor(card.color ?? COLOR.text).font('titleBold').fontSize(16).text(card.value, x + 14, top + 30, { width: width - 28, lineBreak: false });
  });
  doc.y = top + 62 + 22;
}

function drawSectionTitle(doc, dataset, colors) {
  const [background, accent] = colors;
  const top = doc.y;
  doc.roundedRect(MARGIN, top, 6, 22, 3).fill(accent);
  doc.fillColor(COLOR.text).font('titleBold').fontSize(14).text(dataset.label, MARGIN + 14, top + 2);
  const label = `${dataset.rows.length} baris`;
  doc.font('bold').fontSize(8.5);
  const pillWidth = doc.widthOfString(label) + 16;
  const titleWidth = doc.font('titleBold').fontSize(14).widthOfString(dataset.label);
  doc.roundedRect(MARGIN + 24 + titleWidth, top + 3, pillWidth, 17, 8.5).fill(background);
  doc.fillColor(accent).font('bold').fontSize(8.5).text(label, MARGIN + 24 + titleWidth + 8, top + 7);
  doc.y = top + 32;
}

function drawTableHeader(doc, columns, widths, colors) {
  const top = doc.y;
  doc.roundedRect(MARGIN, top, widths.reduce((a, b) => a + b, 0), HEADER_HEIGHT, 8).fill(colors[1]);
  let x = MARGIN;
  doc.fillColor('#ffffff').font('bold').fontSize(8.5);
  columns.forEach((column, index) => {
    const align = ['money', 'number'].includes(column.type) ? 'right' : 'left';
    doc.text(fit(doc, column.label, widths[index] - 14), x + 7, top + 8, { width: widths[index] - 14, align, lineBreak: false });
    x += widths[index];
  });
  doc.y = top + HEADER_HEIGHT + 2;
}

function drawTable(doc, dataset, settings, colors) {
  const available = doc.page.width - MARGIN * 2;
  const bottom = doc.page.height - 46;
  const format = { ...settings, money_format: 'rupiah' }; // PDF untuk dibaca: selalu "Rp 1.500.000"

  // Semua sel diformat dulu; kolom yang kosong (atau 0) di semua baris tidak ditampilkan.
  const allCells = dataset.rows.map((row) => dataset.columns.map((column) => String(formatValue(row[column.key], column.type, format))));
  const keep = dataset.columns.map((column, index) =>
    allCells.some((row) => row[index] !== '' && !(column.type === 'number' && row[index] === '0')));
  const columns = dataset.columns.filter((_, index) => keep[index] || dataset.rows.length === 0);
  const cells = allCells.map((row) => row.filter((_, index) => keep[index]));
  const widths = columnWidths(doc, columns, cells, available);

  if (dataset.rows.length === 0) {
    doc.roundedRect(MARGIN, doc.y, available, 40, 12).dash(4, { space: 3 }).strokeColor(COLOR.border).stroke().undash();
    doc.fillColor(COLOR.muted).font('body').fontSize(10).text('Belum ada data', MARGIN, doc.y + 14, { width: available, align: 'center' });
    doc.y += 40;
    return;
  }

  drawTableHeader(doc, columns, widths, colors);
  dataset.rows.forEach((row, rowIndex) => {
    if (doc.y + ROW_HEIGHT > bottom) {
      doc.addPage();
      doc.fillColor(COLOR.muted).font('bold').fontSize(9).text(`${dataset.label} (lanjutan)`, MARGIN, MARGIN);
      doc.y = MARGIN + 18;
      drawTableHeader(doc, columns, widths, colors);
    }
    const top = doc.y;
    if (rowIndex % 2 === 1) doc.roundedRect(MARGIN, top, available, ROW_HEIGHT, 6).fill(COLOR.zebra);
    let x = MARGIN;
    columns.forEach((column, index) => {
      const value = cells[rowIndex][index];
      const align = ['money', 'number'].includes(column.type) ? 'right' : 'left';
      let color = COLOR.text;
      if (column.type === 'money' && dataset.key === 'transactions') {
        if (row.raw_kind === 'income' || row.raw_kind === 'debt_in' || row.raw_kind === 'asset_in') color = COLOR.positive;
        if (row.raw_kind === 'expense' || row.raw_kind === 'debt_out') color = COLOR.negative;
      }
      doc.fillColor(column.type === 'date' ? COLOR.muted : color)
        .font(column.type === 'money' ? 'bold' : 'body').fontSize(8.8)
        .text(fit(doc, value, widths[index] - PADDING), x + 7, top + 6, { width: widths[index] - 14, align, lineBreak: false });
      x += widths[index];
    });
    doc.y = top + ROW_HEIGHT;
  });
  // garis tipis penutup tabel
  doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + available, doc.y + 2).lineWidth(1).strokeColor(COLOR.border).stroke();
  doc.y += 4;
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const y = doc.page.height - 28;
    const width = doc.page.width;
    doc.save();
    doc.page.margins.bottom = 0;
    [[COLOR.primary, 0], [COLOR.pink, 9], ['#fcd34d', 18]].forEach(([color, dx]) => doc.circle(MARGIN + 3 + dx, y + 5, 3).fill(color));
    doc.fillColor(COLOR.muted).font('bold').fontSize(8.5)
      .text('Celengan · catatan keuangan pribadi', MARGIN + 30, y, { lineBreak: false });
    doc.text(`Halaman ${index + 1} dari ${range.count}`, MARGIN, y, { width: width - MARGIN * 2, align: 'right', lineBreak: false });
    doc.restore();
  }
}

// Ringkasan export biasa: dari transaksi (bila dipilih) + jumlah baris.
function exportCards(datasets) {
  const transactions = datasets.find((dataset) => dataset.key === 'transactions');
  const totalRows = datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
  const cards = [];
  if (transactions) {
    const sum = (kind) => transactions.rows.filter((row) => row.raw_kind === kind).reduce((total, row) => total + row.amount, 0);
    const income = sum('income');
    const expense = sum('expense');
    cards.push(
      { label: 'Pemasukan', value: rupiah(income), colors: PASTELS[2], color: COLOR.positive },
      { label: 'Pengeluaran', value: rupiah(expense), colors: PASTELS[5], color: COLOR.negative },
      { label: 'Selisih', value: rupiah(income - expense), colors: PASTELS[0], color: income - expense < 0 ? COLOR.negative : COLOR.text },
    );
  }
  cards.push({ label: 'Isi laporan', value: `${datasets.length} data · ${totalRows} baris`, colors: PASTELS[3] });
  return cards;
}

// report (opsional): { title, subtitle, cards: [{ label, value, tone? }] } untuk laporan khusus (misal ringkasan pajak).
export function toPdf(datasets, settings, report = null) {
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true,
    info: { Title: 'Celengan — Export data', Author: 'Celengan' },
  });
  doc.registerFont('body', FONTS.body);
  doc.registerFont('bold', FONTS.bold);
  doc.registerFont('title', FONTS.title);
  doc.registerFont('titleBold', FONTS.titleBold);

  const printedAt = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  if (report) {
    drawHeader(doc, { title: report.title, subtitle: report.subtitle, printedAt });
    const tones = { positive: COLOR.positive, negative: COLOR.negative };
    drawSummaryCards(doc, report.cards.map((card, index) => ({ ...card, colors: PASTELS[index % PASTELS.length], color: tones[card.tone] })));
  } else {
    drawHeader(doc, {
      title: datasets.length === 1 ? `Laporan ${datasets[0].label}` : 'Laporan data keuangan',
      subtitle: [settings.period_label && datasets.some((d) => d.key === 'transactions') ? `Periode ${settings.period_label}` : null,
        datasets.map((dataset) => dataset.label).join(', ')].filter(Boolean).join(' · '),
      printedAt,
    });
    drawSummaryCards(doc, exportCards(datasets));
  }

  datasets.forEach((dataset, index) => {
    const colors = PASTELS[index % PASTELS.length];
    // Judul bagian + minimal 2 baris harus muat, kalau tidak pindah halaman.
    if (doc.y + 32 + HEADER_HEIGHT + ROW_HEIGHT * 2 > doc.page.height - 46) doc.addPage();
    drawSectionTitle(doc, dataset, colors);
    drawTable(doc, dataset, settings, colors);
    doc.y += 18;
  });

  drawFooters(doc);
  doc.end();
  return doc;
}
