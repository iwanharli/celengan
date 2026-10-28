import { Router } from 'express';
import { withTransaction, required } from '../db.js';
import { taxStatus, taxCategoryId } from '../tax.js';

const router = Router();

router.get('/', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json(await taxStatus(year));
});

// Bayar pajak: dicatat sebagai pengeluaran kategori "Pajak", mengurangi sisa dana pajak.
router.post('/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note)
       VALUES ('expense', $1, $2, $3, $4, $5)`,
      [req.body.amount, req.body.account_id, await taxCategoryId(client), req.body.date, req.body.note || 'Bayar pajak'],
    );
  });
  res.status(204).end();
});

export default router;
