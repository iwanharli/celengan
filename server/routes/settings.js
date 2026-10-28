import { Router } from 'express';
import { query, required, HttpError } from '../db.js';
import { taxCategoryId } from '../tax.js';
import { PTKP, TAX_METHODS } from '../../public/js/tax-calc.js';

const SETTINGS_COLUMNS = 'month_start_day, income_mode, tax_rate, tax_category_ids, tax_method, tax_norma, tax_ptkp, emergency_months';

const router = Router();

router.get('/', async (req, res) => {
  const [settings] = await query(`SELECT ${SETTINGS_COLUMNS} FROM settings WHERE id = 1`);
  res.json(settings);
});

router.put('/', async (req, res) => {
  required(req.body, ['month_start_day', 'income_mode']);
  // Freelance tidak punya tanggal gajian: periode laporan = bulan kalender biasa.
  const startDay = req.body.income_mode === 'freelance' ? 1 : req.body.month_start_day;

  // Pajak (opsional). Saat pertama diaktifkan tanpa kategori, pakai kategori pemasukan "Freelance".
  const taxRate = Number(req.body.tax_rate ?? 0);
  if (!(taxRate >= 0 && taxRate <= 50)) throw new HttpError(400, 'Persentase pajak harus antara 0 dan 50');
  // Metode pajak: flat (persentase tetap) / final (PPh Final 0,5%) / nppn (norma + PTKP).
  const taxMethod = TAX_METHODS[req.body.tax_method] ? req.body.tax_method : 'flat';
  const taxNorma = req.body.tax_norma === '' || req.body.tax_norma == null ? null : Number(req.body.tax_norma);
  const taxPtkp = PTKP[req.body.tax_ptkp] ? req.body.tax_ptkp : 'TK/0';
  if (taxMethod === 'nppn' && !(taxNorma > 0 && taxNorma <= 100)) {
    throw new HttpError(400, 'Isi persentase norma NPPN (1–100%) sesuai profesi & kotamu');
  }
  const emergencyMonths = req.body.emergency_months == null ? null : Number(req.body.emergency_months);
  if (emergencyMonths !== null && !(Number.isInteger(emergencyMonths) && emergencyMonths >= 1 && emergencyMonths <= 24)) {
    throw new HttpError(400, 'Target dana darurat antara 1 dan 24 bulan');
  }
  const taxActive = taxMethod === 'flat' ? taxRate > 0 : true;

  let taxCategoryIds = (req.body.tax_category_ids ?? []).map(Number);
  if (taxActive) {
    if (taxCategoryIds.length === 0) {
      const freelance = await query(`SELECT id FROM categories WHERE kind = 'income' AND name = 'Freelance'`);
      taxCategoryIds = freelance.length
        ? [freelance[0].id]
        : (await query(`INSERT INTO categories (name, kind, icon, color) VALUES ('Freelance', 'income', 'laptop', '#0ea5e9') RETURNING id`)).map((row) => row.id);
    }
    await taxCategoryId(); // siapkan kategori pengeluaran "Pajak"
  }

  const [settings] = await query(
    `UPDATE settings SET month_start_day = $1, income_mode = $2, tax_rate = $3, tax_category_ids = $4,
            tax_method = $5, tax_norma = $6, tax_ptkp = $7, emergency_months = COALESCE($8, emergency_months)
     WHERE id = 1
     RETURNING ${SETTINGS_COLUMNS}`,
    [startDay, req.body.income_mode, taxRate, taxCategoryIds, taxMethod, taxNorma, taxPtkp, emergencyMonths],
  );
  res.json(settings);
});

export default router;
