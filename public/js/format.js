const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export const rupiah = (amount) => rupiahFormatter.format(amount ?? 0);

// Versi ringkas untuk grafik: 1.500.000 -> "1,5 jt"
export const rupiahShort = (amount) =>
  new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(amount);

// Mengubah ketikan bebas jadi angka: "25rb" -> 25000, "1,5jt" -> 1500000, "Rp 50.000" -> 50000
export function parseAmount(text) {
  const clean = String(text ?? '').toLowerCase().replace(/rp|\s/g, '');
  const match = clean.match(/^([\d.,]+)(rb|ribu|k|jt|juta)?$/);
  if (!match) return 0;

  const [, digits, suffix] = match;
  const multiplier = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6 }[suffix] ?? 1;
  const number = suffix
    ? Number(digits.replace(/\./g, '').replace(',', '.'))  // "1,5jt": koma = desimal
    : Number(digits.replace(/[.,]/g, ''));                  // "50.000": titik = ribuan
  return Math.round(number * multiplier) || 0;
}

export const todayISO = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

export const monthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

export const shortMonthLabel = (month) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short' });

// '2026-11-15' -> "Nov 2026"
export const formatMonthYear = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });

// Tanggal 31 + 1 bulan → hari terakhir bulan berikutnya (bukan meluber ke awal bulan sesudahnya).
export function addMonths(iso, months) {
  const [year, month, day] = iso.split('-').map(Number);
  const lastDayOfTarget = new Date(year, month - 1 + months + 1, 0).getDate();
  const date = new Date(year, month - 1 + months, Math.min(day, lastDayOfTarget));
  return date.toLocaleDateString('sv-SE'); // 'YYYY-MM-DD' waktu lokal
}

export function daysUntil(iso) {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

export function shiftMonth(month, offset) {
  const date = new Date(`${month}-01T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(startDay) {
  const today = new Date();
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return today.getDate() < startDay ? shiftMonth(month, -1) : month;
}

// Nominal untuk ditampilkan di kolom input: 1500000 → "1.500.000", "-500000" → "-500.000".
// Teks singkatan ("25rb", "1,5jt") dibiarkan apa adanya.
export function formatAmountInput(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(-?)([\d.]+)$/);
  if (!match) return text;
  const digits = match[2].replace(/\./g, '').replace(/^0+(?=\d)/, '');
  return digits ? match[1] + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : match[1];
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
}

export const daysBetween = (startIso, endIso) =>
  Math.round((new Date(`${endIso}T00:00:00`) - new Date(`${startIso}T00:00:00`)) / 86400000);

// "1 Agu – 28 Okt 2026", "1 – 28 Okt 2026", "28 Des 2025 – 3 Jan 2026"
export function formatRange(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const full = { day: 'numeric', month: 'short', year: 'numeric' };
  if (startIso === endIso) return end.toLocaleDateString('id-ID', full);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const left = start.toLocaleDateString('id-ID', sameMonth ? { day: 'numeric' } : sameYear ? { day: 'numeric', month: 'short' } : full);
  return `${left} – ${end.toLocaleDateString('id-ID', full)}`;
}
