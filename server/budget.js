import { query } from './db.js';
import { periodRange, shiftMonth, getStartDay, currentMonth } from './period.js';

// Panduan umum porsi pengeluaran dari pemasukan bulanan (kategori bawaan).
// Hanya patokan kasar — kondisi tiap orang berbeda.
export const BUDGET_GUIDELINES = {
  'Makan & Minum': [15, 25],
  Transportasi: [5, 10],
  Tagihan: [10, 15],
  Belanja: [5, 10],
  Rumah: [20, 30],
  Kesehatan: [3, 5],
  Hiburan: [5, 10],
  Pendidikan: [5, 10],
  Lainnya: [2, 5],
};

// Anggaran efektif: persen × pemasukan acuan, atau nominal tetap.
export function effectiveBudget(category, referenceIncome) {
  if (category.budget_percent) return referenceIncome > 0 ? Math.round((referenceIncome * category.budget_percent) / 100) : null;
  return category.monthly_budget;
}

// Bulatkan ke Rp 10.000 (atau Rp 1.000 untuk nominal kecil) supaya enak dibaca.
const roundNice = (amount) => {
  const step = amount >= 100000 ? 10000 : 1000;
  return Math.max(step, Math.round(amount / step) * step);
};

// Saran anggaran satu kategori dari riwayat belanjanya.
//   history: belanja 6 periode terakhir (yang sudah selesai)
//   referenceIncome: rata-rata pemasukan (dasar anggaran persen)
export async function budgetSuggestions(category, referenceIncome) {
  const startDay = await getStartDay();
  const month = currentMonth(startDay);
  const ranges = [6, 5, 4, 3, 2, 1].map((offset) => periodRange(shiftMonth(month, -offset), startDay));

  const history = await Promise.all(ranges.map(async (range) => {
    const [row] = await query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS spent FROM transactions
       WHERE category_id = $1 AND kind = 'expense' AND date >= $2 AND date < $3`,
      [category.id, range.start, range.end],
    );
    return { month: range.month, spent: row.spent };
  }));

  const recent = history.slice(-3).filter((row) => row.spent > 0);
  const average3 = recent.length ? Math.round(recent.reduce((sum, row) => sum + row.spent, 0) / recent.length) : 0;
  const lastMonth = history.at(-1).spent;
  const highest = Math.max(...history.map((row) => row.spent));

  const options = [];
  if (average3) {
    options.push({ key: 'average', label: 'Rata-rata 3 bulan', amount: roundNice(average3) });
    options.push({ key: 'save', label: 'Hemat 10%', amount: roundNice(average3 * 0.9) });
  }
  if (lastMonth && roundNice(lastMonth) !== roundNice(average3)) options.push({ key: 'last', label: 'Bulan lalu', amount: roundNice(lastMonth) });
  if (highest && highest > average3 * 1.15) options.push({ key: 'highest', label: 'Tertinggi', amount: roundNice(highest) });

  const guideline = BUDGET_GUIDELINES[category.name];
  return {
    history,
    average3,
    lastMonth,
    highest,
    referenceIncome,
    // Persentase rata-rata belanja kategori ini terhadap pemasukan.
    averagePercent: referenceIncome > 0 && average3 ? Math.round((average3 / referenceIncome) * 1000) / 10 : null,
    options,
    guideline: guideline ? { min: guideline[0], max: guideline[1], suggested: Math.round((guideline[0] + guideline[1]) / 2) } : null,
  };
}
