// Hitung pajak freelancer — dipakai di server (server/tax.js) & browser, supaya angkanya selalu sama.
// Semua angka per TAHUN pajak (Januari–Desember). Ini perkiraan, bukan pengganti konsultan pajak.
//
// Metode:
//   flat  : persentase tetap × penghasilan bruto (cara lama / arahan konsultan)
//   final : PPh Final 0,5% (PP 55/2022 jo. PP 20/2026) — omzet Rp500 juta pertama per tahun bebas pajak
//   nppn  : Norma Penghitungan Penghasilan Neto — neto = norma% × bruto, lalu − PTKP, lalu tarif progresif

export const TAX_METHODS = {
  nppn: { label: 'NPPN (pekerjaan bebas)', hint: 'Untuk jasa yang kamu kerjakan sendiri: desainer, programmer, konsultan, kreator, penerjemah, dll.' },
  final: { label: 'PPh Final 0,5%', hint: 'Untuk usaha (punya karyawan / jualan). Omzet Rp500 juta pertama per tahun bebas pajak.' },
  flat: { label: 'Persentase tetap', hint: 'Sisihkan persentase tertentu dari setiap pemasukan, misal sesuai arahan konsultan.' },
};

// PTKP per tahun (PMK 101/PMK.010/2016): TK = tidak kawin, K = kawin, angka = jumlah tanggungan (maks. 3).
export const PTKP = {
  'TK/0': 54000000, 'TK/1': 58500000, 'TK/2': 63000000, 'TK/3': 67500000,
  'K/0': 58500000, 'K/1': 63000000, 'K/2': 67500000, 'K/3': 72000000,
};

// Tarif progresif PPh orang pribadi (UU HPP): [batas atas lapisan, tarif %].
export const PPH_BRACKETS = [[60000000, 5], [250000000, 15], [500000000, 25], [5000000000, 30], [Infinity, 35]];

export const FINAL_FREE_LIMIT = 500000000;
export const FINAL_RATE = 0.5;

export function progressiveTax(taxableIncome) {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of PPH_BRACKETS) {
    if (taxableIncome <= lower) break;
    tax += ((Math.min(taxableIncome, upper) - lower) * rate) / 100;
    lower = upper;
  }
  return Math.round(tax);
}

// Pajak setahun dari penghasilan bruto setahun.
// settings: { method, rate (flat), norma (nppn, %), ptkp (nppn, kode PTKP) }
export function annualTax(gross, settings) {
  if (!(gross > 0)) return 0;
  if (settings.method === 'final') return Math.round((Math.max(0, gross - FINAL_FREE_LIMIT) * FINAL_RATE) / 100);
  if (settings.method === 'nppn') {
    const net = (gross * (settings.norma ?? 0)) / 100;
    const taxable = Math.floor(Math.max(0, net - (PTKP[settings.ptkp] ?? PTKP['TK/0'])) / 1000) * 1000; // PKP dibulatkan ke bawah ribuan
    return progressiveTax(taxable);
  }
  return Math.round((gross * (settings.rate ?? 0)) / 100);
}

// Bagian pajak dari sebuah pemasukan baru, mengingat pemasukan sebelumnya di tahun yang sama
// (penting untuk NPPN & PPh Final: pemasukan awal tahun bisa Rp0 pajaknya, belakangan lebih besar).
export function taxShareOf(amount, grossBefore, settings) {
  return Math.max(0, annualTax(grossBefore + amount, settings) - annualTax(grossBefore, settings));
}
