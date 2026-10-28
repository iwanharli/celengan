import { Router } from 'express';
import { query, required, HttpError } from '../db.js';
import { taxCategoryId } from '../tax.js';

const SETTINGS_COLUMNS = 'month_start_day, income_mode, tax_rate, tax_category_ids';

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
  let taxCategoryIds = (req.body.tax_category_ids ?? []).map(Number);
  if (taxRate > 0) {
    if (taxCategoryIds.length === 0) {
      const freelance = await query(`SELECT id FROM categories WHERE kind = 'income' AND name = 'Freelance'`);
      taxCategoryIds = freelance.length
        ? [freelance[0].id]
        : (await query(`INSERT INTO categories (name, kind, icon, color) VALUES ('Freelance', 'income', 'laptop', '#0ea5e9') RETURNING id`)).map((row) => row.id);
    }
    await taxCategoryId(); // siapkan kategori pengeluaran "Pajak"
  }

  const [settings] = await query(
    `UPDATE settings SET month_start_day = $1, income_mode = $2, tax_rate = $3, tax_category_ids = $4 WHERE id = 1
     RETURNING ${SETTINGS_COLUMNS}`,
    [startDay, req.body.income_mode, taxRate, taxCategoryIds],
  );
  res.json(settings);
});

export default router;
