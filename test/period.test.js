import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const food = await categoryId(app.api, 'Makan & Minum');
  for (const [date, amount] of [['2026-07-31', 10000], ['2026-08-01', 20000], ['2026-09-15', 30000], ['2026-10-28', 40000], ['2026-10-29', 50000]]) {
    await app.api.post('/transactions', { kind: 'expense', amount, account_id: account.id, category_id: food, date });
  }
});
after(() => app.close());

test('rentang tanggal bebas (tanggal akhir ikut dihitung)', async () => {
  const summary = await app.api.get('/summary?start=2026-08-01&end=2026-10-28');
  assert.deepEqual(summary.period, { month: '2026-10', start: '2026-08-01', end: '2026-10-29', custom: true });
  assert.equal(summary.expense, 20000 + 30000 + 40000);
  const transactions = await app.api.get('/transactions?start=2026-08-01&end=2026-10-28');
  assert.equal(transactions.length, 3);
});

test('rentang satu hari', async () => {
  const transactions = await app.api.get('/transactions?start=2026-10-29&end=2026-10-29');
  assert.deepEqual(transactions.map((t) => t.amount), [50000]);
});

test('rentang tidak valid → kembali ke periode bulanan', async () => {
  const summary = await app.api.get('/summary?month=2026-07&start=2026-10-01&end=2026-09-01');
  assert.equal(summary.period.custom, undefined);
  assert.equal(summary.expense, 10000);
});
