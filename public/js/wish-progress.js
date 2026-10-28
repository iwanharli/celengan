// Status tabungan wishlist terhadap target tanggal. Fungsi murni (tanpa DOM) supaya mudah dites.
//
// Uang dianggap perlu terkumpul merata dari hari barang dimasukkan sampai tanggal target.
//   seharusnya terkumpul hari ini = harga × (hari berjalan ÷ total hari)
// Status:
//   ahead    → lebih dari seharusnya (selisih > toleransi)
//   on_track → selisih masih dalam toleransi (2% harga)
//   behind   → kurang dari seharusnya
//   late     → tanggal target sudah lewat, dana belum cukup
// null jika barang tanpa target atau dananya sudah cukup.

const DAY = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00`);
const TOLERANCE = 0.02;

export function wishTargetStatus(item, today) {
  if (!item.target_date || item.saved >= item.price) return null;

  const start = toDate(item.created_at.slice(0, 10));
  const target = toDate(item.target_date);
  const now = toDate(today);
  const remaining = item.price - item.saved;

  if (now > target || target <= start) {
    return { level: 'late', daysLate: Math.round((now - target) / DAY), remaining, expected: item.price, percentExpected: 100 };
  }

  const progress = Math.min(1, Math.max(0, (now - start) / (target - start)));
  const expected = Math.round(item.price * progress);
  const gap = item.saved - expected; // positif = lebih cepat
  const tolerance = item.price * TOLERANCE;
  const monthsLeft = Math.max(1, Math.ceil((target - now) / DAY / 30));

  return {
    level: gap > tolerance ? 'ahead' : gap >= -tolerance ? 'on_track' : 'behind',
    expected,
    gap,
    percentExpected: Math.round(progress * 100),
    // Untuk mengejar target: sisihkan sekian per bulan sampai tanggal target.
    perMonth: Math.ceil(remaining / monthsLeft),
  };
}
