import { query } from './db.js';

// Satu "bulan" dimulai pada tanggal gajian (month_start_day), bukan selalu tanggal 1.
// Periode diberi label bulan tempat ia dimulai, misal "2026-10" = 25 Okt s/d 24 Nov.

const toISO = (date) => date.toISOString().slice(0, 10);

export async function getStartDay() {
  const [settings] = await query('SELECT month_start_day FROM settings WHERE id = 1');
  return settings.month_start_day;
}

export function currentMonth(startDay, today = new Date()) {
  const date = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
  if (today.getDate() < startDay) date.setUTCMonth(date.getUTCMonth() - 1);
  return toISO(date).slice(0, 7);
}

export function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split('-').map(Number);
  return toISO(new Date(Date.UTC(year, monthNumber - 1 + offset, 1))).slice(0, 7);
}

// Mengembalikan { month, start, end } dengan end bersifat eksklusif.
export function periodRange(month, startDay) {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    month,
    start: toISO(new Date(Date.UTC(year, monthNumber - 1, startDay))),
    end: toISO(new Date(Date.UTC(year, monthNumber, startDay))),
  };
}

export async function periodFor(month) {
  const startDay = await getStartDay();
  const valid = /^\d{4}-\d{2}$/.test(month ?? '');
  return periodRange(valid ? month : currentMonth(startDay), startDay);
}

// Periode dari query string:
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD  → rentang bebas (end termasuk), misal 1 Agu – 28 Okt
//   ?month=YYYY-MM                    → periode bulanan biasa (mengikuti tanggal gajian)
// Hasil selalu { month, start, end } dengan end eksklusif; month = bulan tempat rentang berakhir
// (dipakai untuk tren 6 bulan & perkiraan tabungan).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function periodFromQuery(query) {
  const { start, end } = query;
  if (ISO_DATE.test(start ?? '') && ISO_DATE.test(end ?? '') && start <= end) {
    const after = new Date(`${end}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    return { month: end.slice(0, 7), start, end: toISO(after), custom: true };
  }
  return periodFor(query.month);
}
