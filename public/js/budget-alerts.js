// Peringatan anggaran untuk Beranda. Fungsi murni (tanpa DOM) supaya mudah dites.
//
// Untuk tiap kategori yang punya anggaran:
//   over      → sudah melebihi anggaran
//   almost    → sudah ≥ 80% terpakai
//   fast      → laju belanja jauh lebih cepat dari waktu yang berjalan
//               (perkiraan akhir periode > anggaran, dan terpakai ≥ waktu berjalan + 15 poin)
// Hasil diurutkan dari yang paling parah.

const SEVERITY = { over: 0, almost: 1, fast: 2 };

const toDate = (iso) => new Date(`${iso}T00:00:00`);

// Seberapa jauh periode sudah berjalan, 0..1. (end eksklusif)
export function periodProgress({ start, end }, today) {
  const total = toDate(end) - toDate(start);
  const elapsed = toDate(today) - toDate(start) + 86400000; // hari ini dihitung
  return Math.min(1, Math.max(0, elapsed / total));
}

export function budgetAlerts(categories, period, today) {
  const progress = periodProgress(period, today);
  const daysLeft = Math.max(0, Math.round((toDate(period.end) - toDate(today)) / 86400000) - 1);

  return categories
    .filter((category) => category.monthly_budget > 0 && category.spent > 0)
    .map((category) => {
      const budget = category.monthly_budget;
      const used = category.spent / budget;
      const projected = progress > 0 ? Math.round(category.spent / progress) : category.spent;

      let level = null;
      if (used >= 1) level = 'over';
      else if (used >= 0.8) level = 'almost';
      else if (projected > budget && used >= progress + 0.15) level = 'fast';
      if (!level) return null;

      return {
        ...category,
        level,
        percentUsed: Math.round(used * 100),
        percentTime: Math.round(progress * 100),
        projected,
        projectedOver: Math.max(0, projected - budget),
        remaining: Math.max(0, budget - category.spent),
        overBy: Math.max(0, category.spent - budget),
        // Supaya tidak melebihi anggaran: maksimal belanja per hari untuk sisa periode.
        dailyAllowance: daysLeft > 0 ? Math.floor(Math.max(0, budget - category.spent) / daysLeft) : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level] || b.percentUsed - a.percentUsed);
}
