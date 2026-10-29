import { Router } from 'express';
import { query, required, HttpError } from '../db.js';

// Transaksi favorit: simpan isian yang sering dipakai (misal "Kopi 18rb dari GoPay"),
// lalu catat dengan sekali klik.
const router = Router();

router.get('/', async (req, res) => {
  res.json(await query(
    `SELECT tt.*, c.icon AS category_icon, c.color AS category_color, a.name AS account_name
     FROM transaction_templates tt
     LEFT JOIN categories c ON c.id = tt.category_id
     LEFT JOIN accounts a   ON a.id = tt.account_id
     ORDER BY tt.position, tt.id`,
  ));
});

router.post('/', async (req, res) => {
  required(req.body, ['name', 'kind', 'amount', 'account_id']);
  const { name, kind, amount, account_id, to_account_id, category_id, note } = req.body;
  if (kind === 'transfer' ? !to_account_id : !category_id) throw new HttpError(400, 'Lengkapi kategori / akun tujuan dulu');
  const [{ count }] = await query('SELECT count(*)::int AS count FROM transaction_templates');
  if (count >= 12) throw new HttpError(400, 'Maksimal 12 favorit');
  const [template] = await query(
    `INSERT INTO transaction_templates (name, kind, amount, account_id, to_account_id, category_id, note, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name.trim().slice(0, 40), kind, amount, account_id, kind === 'transfer' ? to_account_id : null,
      kind === 'transfer' ? null : category_id, note || null, count],
  );
  res.status(201).json(template);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM transaction_templates WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

export default router;
