// Membaca mutasi rekening (CSV / Excel internet banking) jadi baris transaksi.
// Fungsi murni tanpa DOM, dipakai di browser (modal Import) & di test.
//
//   rows (array of array dari CSV/Excel) → findHeader → guessMapping → parseStatement → [{ date, note, amount, kind }]

const HEADER_HINTS = {
  date: /^(tgl|tanggal|date|tanggal transaksi|transaction date|posting date|tgl\.? transaksi)$/i,
  note: /(keterangan|deskripsi|description|uraian|remark|detail|berita|transaksi$)/i,
  amount: /^(jumlah|amount|nominal|mutasi|nilai)$/i,
  debit: /^(debit|debet|db|keluar|pengeluaran|withdrawal|uang keluar)$/i,
  credit: /^(kredit|credit|cr|masuk|pemasukan|deposit|uang masuk)$/i,
  type: /^(db\/cr|cr\/db|d\/k|jenis|tipe|type)$/i,
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// Baris judul = baris pertama yang punya kolom tanggal + minimal 2 kolom terisi lain.
export function findHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const cells = rows[index].map(clean);
    if (cells.some((cell) => HEADER_HINTS.date.test(cell)) && cells.filter(Boolean).length >= 3) return index;
  }
  return 0;
}

// Tebak kolom: { date, note, amount, debit, credit, type } → indeks kolom (atau -1).
export function guessMapping(header) {
  const cells = header.map(clean);
  const taken = new Set();
  // Urutan penting: kolom tanggal dulu, supaya "Tanggal Transaksi" tidak dianggap keterangan.
  const find = (key) => {
    const index = cells.findIndex((cell, i) => !taken.has(i) && HEADER_HINTS[key].test(cell));
    if (index >= 0) taken.add(index);
    return index;
  };
  const date = find('date');
  const type = find('type');
  return { date, type, debit: find('debit'), credit: find('credit'), amount: find('amount'), note: find('note') };
}

// "1.234.567,00" | "1,234,567.00" | "Rp 50.000" | "-25.000" | "250,000.00 DB" → { value, sign }
export function parseMoney(raw) {
  if (typeof raw === 'number') return { value: Math.abs(Math.round(raw)), sign: Math.sign(raw) || 1 };
  let text = clean(raw).toUpperCase();
  if (!text) return { value: 0, sign: 1 };
  let sign = 1;
  if (/\b(DB|D|DEBIT)\s*$/.test(text) || text.startsWith('-') || /^\(.*\)$/.test(text)) sign = -1;
  text = text.replace(/\b(CR|DB|D|K|DEBIT|KREDIT|CREDIT|RP|IDR)\b/g, '').replace(/[^\d.,]/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  // Pemisah desimal = pemisah terakhir yang diikuti 1–2 angka.
  if (decimalAt >= 0 && text.length - decimalAt - 1 <= 2 && (lastComma >= 0 && lastDot >= 0 || text.length - decimalAt - 1 !== 3)) {
    text = `${text.slice(0, decimalAt).replace(/[.,]/g, '')}.${text.slice(decimalAt + 1)}`;
  } else {
    text = text.replace(/[.,]/g, '');
  }
  return { value: Math.round(Number(text) || 0), sign };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const pad = (number) => String(number).padStart(2, '0');

// Tanggal: Date, serial Excel, "dd/mm/yyyy", "dd-mm-yy", "yyyy-mm-dd", "dd/mm" (tahun = year), "12 Okt 2026".
export function parseDate(raw, year = new Date().getFullYear()) {
  if (raw instanceof Date && !Number.isNaN(raw)) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = clean(raw).toLowerCase();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (match) {
    const fullYear = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    return `${fullYear}-${pad(match[2])}-${pad(match[1])}`;
  }
  match = text.match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2,4})/);
  if (match && MONTHS[match[2]]) {
    const fullYear = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return `${fullYear}-${pad(MONTHS[match[2]])}-${pad(match[1])}`;
  }
  return null;
}

// Baris data → transaksi. Baris tanpa tanggal valid / nominal 0 (saldo awal, total, pendahuluan) dilewati.
export function parseStatement(rows, headerIndex, mapping, year) {
  const result = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const date = mapping.date >= 0 ? parseDate(row[mapping.date], year) : null;
    if (!date) continue;
    let amount = 0;
    let sign = 1;
    if (mapping.debit >= 0 || mapping.credit >= 0) {
      const debit = mapping.debit >= 0 ? parseMoney(row[mapping.debit]).value : 0;
      const credit = mapping.credit >= 0 ? parseMoney(row[mapping.credit]).value : 0;
      amount = debit || credit;
      sign = debit ? -1 : 1;
    } else if (mapping.amount >= 0) {
      ({ value: amount, sign } = parseMoney(row[mapping.amount]));
      if (mapping.type >= 0 && /^(db|d|debit|debet)$/i.test(clean(row[mapping.type]))) sign = -1;
    }
    if (!amount) continue;
    const note = mapping.note >= 0 ? clean(row[mapping.note]) : '';
    result.push({ date, note, amount, kind: sign < 0 ? 'expense' : 'income' });
  }
  return result;
}

// Kata kunci umum → nama kategori (dipakai kalau belum ada riwayat dengan keterangan serupa).
export const CATEGORY_KEYWORDS = [
  [/gojek|go-?ride|go-?car|grab|maxim|krl|mrt|transjakarta|pertamina|shell|spbu|tol\b|parkir|kai\b|tiket\.com|traveloka/i, 'Transportasi'],
  [/go-?food|grabfood|shopeefood|resto|kopi|coffee|cafe|mcd|kfc|warung|bakso|makan/i, 'Makan & Minum'],
  [/indomaret|alfamart|alfamidi|superindo|hypermart|tokopedia|shopee(?!food|pay)|lazada|blibli|belanja/i, 'Belanja'],
  [/pln|token listrik|pdam|telkom|indihome|biznet|first ?media|pulsa|paket data|bpjs/i, 'Tagihan'],
  [/netflix|spotify|youtube|disney|vidio|apple\.com|icloud|google ?(one|storage)|chatgpt|openai|canva|adobe/i, 'Langganan aplikasi'],
  [/apotek|klinik|rumah sakit|\brs\b|dokter|halodoc|kimia farma/i, 'Kesehatan'],
  [/biaya adm|biaya admin|adm(in)? fee|biaya transfer|bi-?fast/i, 'Biaya admin'],
  [/pajak|djp|e-?billing/i, 'Pajak'],
  [/gaji|salary|payroll/i, 'Gaji'],
  [/bunga|interest|dividen/i, 'Bunga & Dividen'],
  [/cashback|refund|pengembalian/i, 'Cashback & Refund'],
];

export function guessCategoryName(note) {
  return CATEGORY_KEYWORDS.find(([pattern]) => pattern.test(note))?.[1] ?? null;
}

// Kunci pembanding keterangan: huruf kecil, tanpa angka & tanda baca (nomor referensi berbeda-beda).
export const noteKey = (note) => clean(note).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
