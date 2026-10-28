import { Router } from 'express';
import { pool, query, withTransaction, required, HttpError } from '../db.js';
import { writeSafetyBackup } from '../backup.js';
import { budgetSuggestions } from '../budget.js';
import { savingsEstimate } from '../savings.js';
import { getTaxSettings } from '../tax.js';
import { currentMonth, getStartDay } from '../period.js';

const router = Router();

// Setiap kategori disertai statistik pemakaian. Urutan: yang paling sering dipakai
// 90 hari terakhir di depan, supaya form transaksi cepat diisi.
router.get('/', async (req, res) => {
  res.json(await query(
    `SELECT c.*,
            count(t.id)::int                                              AS usage_count,
            COALESCE(SUM(t.amount), 0)::bigint                            AS usage_total,
            max(t.date)                                                   AS last_used,
            count(t.id) FILTER (WHERE t.date >= current_date - 90)::int   AS recent_count,
            (SELECT count(*)::int FROM bills b WHERE b.category_id = c.id AND b.active) AS bill_count
     FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id
     GROUP BY c.id
     ORDER BY c.kind DESC, c.archived, recent_count DESC, usage_count DESC, c.id`,
  ));
});

router.post('/', async (req, res) => {
  required(req.body, ['name', 'kind']);
  const { name, kind, icon = 'tag', color = '#64748b', monthly_budget = null } = req.body;
  const [category] = await query(
    `INSERT INTO categories (name, kind, icon, color, monthly_budget)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name.trim(), kind, icon, color, monthly_budget],
  );
  res.status(201).json(category);
});

router.put('/:id', async (req, res) => {
  required(req.body, ['name', 'icon', 'color']);
  const [category] = await query(
    'UPDATE categories SET name = $1, icon = $2, color = $3 WHERE id = $4 RETURNING *',
    [req.body.name.trim(), req.body.icon, req.body.color, req.params.id],
  );
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  res.json(category);
});

// Arsipkan / aktifkan lagi.
router.put('/:id/archive', async (req, res) => {
  const [category] = await query(
    'UPDATE categories SET archived = $1 WHERE id = $2 RETURNING *',
    [Boolean(req.body.archived), req.params.id],
  );
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  res.json(category);
});

// Seberapa banyak sebuah kategori dipakai.
async function usageOf(db, category) {
  const { rows: [usage] } = await db.query(
    `SELECT (SELECT count(*)::int FROM transactions WHERE category_id = $1) AS transactions,
            (SELECT count(*)::int FROM bills WHERE category_id = $1)        AS bills,
            (SELECT $1 = ANY(tax_category_ids) FROM settings WHERE id = 1)  AS taxed`,
    [category.id],
  );
  return { ...usage, used: usage.transactions > 0 || usage.bills > 0 || usage.taxed };
}

// Hapus kategori.
// - Belum pernah dipakai → langsung dihapus.
// - Sudah dipakai → WAJIB dipindah dulu, ke kategori yang ada ("into") atau kategori baru ("newCategory").
//   Isinya (transaksi, tagihan, anggaran, pengaturan pajak) pindah semua, lalu kategori lama dihapus.
//   Sebelumnya dibuat backup pengaman otomatis. (Pilihan "arsipkan" memakai PUT /:id/archive.)
router.post('/:id/delete', async (req, res) => {
  const { into, newCategory } = req.body;
  const [category] = await query('SELECT * FROM categories WHERE id = $1', [req.params.id]);
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');

  const usage = await usageOf(pool, category);
  if (usage.used && !into && !newCategory) {
    throw new HttpError(400, 'Kategori ini sudah dipakai. Gabungkan ke kategori lain, pindahkan ke kategori baru, atau arsipkan.');
  }
  if (newCategory && !newCategory.name?.trim()) throw new HttpError(400, 'Nama kategori baru wajib diisi');

  const backupFile = usage.used ? await writeSafetyBackup(`gabung-kategori-${category.name}`) : null;

  const target = await withTransaction(async (client) => {
    let target = null;
    if (newCategory) {
      ({ rows: [target] } = await client.query(
        `INSERT INTO categories (name, kind, icon, color) VALUES ($1, $2, $3, $4) RETURNING *`,
        [newCategory.name.trim(), category.kind, newCategory.icon || category.icon, newCategory.color || category.color],
      ));
    } else if (into) {
      ({ rows: [target] } = await client.query('SELECT * FROM categories WHERE id = $1', [Number(into)]));
      if (!target || target.id === category.id) throw new HttpError(400, 'Pilih kategori tujuan yang lain');
      if (target.kind !== category.kind) throw new HttpError(400, 'Kategori tujuan harus sejenis (pengeluaran/pemasukan)');
    }

    if (target) {
      await client.query('UPDATE transactions SET category_id = $1 WHERE category_id = $2', [target.id, category.id]);
      await client.query('UPDATE bills SET category_id = $1 WHERE category_id = $2', [target.id, category.id]);
      // Anggaran digabung: tujuan mendapat anggaran keduanya.
      if (category.monthly_budget && !target.budget_percent) {
        await client.query(
          'UPDATE categories SET monthly_budget = COALESCE(monthly_budget, 0) + $1 WHERE id = $2',
          [category.monthly_budget, target.id],
        );
      }
      if (category.budget_percent && !target.monthly_budget) {
        await client.query(
          'UPDATE categories SET budget_percent = LEAST(100, COALESCE(budget_percent, 0) + $1) WHERE id = $2',
          [category.budget_percent, target.id],
        );
      }
      // Kategori kena pajak: tujuan ikut kena pajak.
      await client.query(
        `UPDATE settings SET tax_category_ids = (
           SELECT COALESCE(array_agg(DISTINCT tax_id), '{}')
           FROM unnest(array_replace(tax_category_ids, $1::int, $2::int)) AS tax_id
         ) WHERE id = 1`,
        [category.id, target.id],
      );
    }

    await client.query('DELETE FROM categories WHERE id = $1', [category.id]);
    return target;
  });
  res.json({ target, backupFile });
});

// Dipakai halaman Anggaran. Kirim salah satu:
//   { monthly_budget }  nominal tetap
//   { budget_percent }  persen dari rata-rata pemasukan (0,5–100)
// Keduanya kosong = hapus anggaran.
router.put('/:id/budget', async (req, res) => {
  const percent = Number(String(req.body.budget_percent ?? '').replace(',', '.')) || null;
  const amount = percent ? null : Number(req.body.monthly_budget) > 0 ? Number(req.body.monthly_budget) : null;
  if (percent !== null && (percent <= 0 || percent > 100)) throw new HttpError(400, 'Persentase anggaran harus antara 0 dan 100');
  const [category] = await query(
    'UPDATE categories SET monthly_budget = $1, budget_percent = $2 WHERE id = $3 RETURNING *',
    [amount, percent, req.params.id],
  );
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  res.json(category);
});

// Saran anggaran dari riwayat belanja + panduan umum.
router.get('/:id/budget-suggestions', async (req, res) => {
  const [category] = await query('SELECT * FROM categories WHERE id = $1', [req.params.id]);
  if (!category) throw new HttpError(404, 'Kategori tidak ditemukan');
  // Pemasukan acuan sama dengan di Beranda (rata-rata 3 bulan, freelance 6 bulan).
  const startDay = await getStartDay();
  const [{ income_mode: incomeMode }] = await query('SELECT income_mode FROM settings WHERE id = 1');
  const { income } = await savingsEstimate(currentMonth(startDay), startDay, incomeMode, await getTaxSettings());
  res.json(await budgetSuggestions(category, income));
});

export default router;
