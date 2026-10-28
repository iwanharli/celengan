import { Router } from 'express';
import { query } from '../db.js';

// Riwayat perubahan transaksi (dicatat trigger di database), dipasang di bawah /api/transactions.
const router = Router();

// Transaksi yang baru dihapus (30 terakhir), untuk melihat apa yang hilang.
router.get('/history/deleted', async (req, res) => {
  res.json(await query(
    `SELECT h.id, h.transaction_id, h.snapshot, h.created_at,
            a.name AS account_name, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transaction_history h
     LEFT JOIN accounts a   ON a.id = (h.snapshot ->> 'account_id')::int
     LEFT JOIN categories c ON c.id = (h.snapshot ->> 'category_id')::int
     WHERE h.action = 'deleted'
     ORDER BY h.id DESC LIMIT 30`,
  ));
});

router.get('/:id/history', async (req, res) => {
  res.json(await query(
    'SELECT id, action, changes, snapshot, created_at FROM transaction_history WHERE transaction_id = $1 ORDER BY id DESC',
    [req.params.id],
  ));
});

export default router;
