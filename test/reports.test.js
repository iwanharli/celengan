import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const salary = await categoryId(app.api, 'Gaji');
  const food = await categoryId(app.api, 'Makan & Minum');
  const shopping = await categoryId(app.api, 'Belanja');
  const add = (kind, amount, category, date, note) =>
    app.api.post('/transactions', { kind, amount, account_id: account.id, category_id: category, date, note });

  await add('income', 8000000, salary, '2025-06-01');
  await add('expense', 5000000, food, '2025-06-02');
  await add('income', 8000000, salary, '2026-01-25');
  await add('income', 8000000, salary, '2026-02-25');
  await add('expense', 3000000, food, '2026-01-10');
  await add('expense', 1000000, food, '2026-02-10');
  await add('expense', 4500000, shopping, '2026-02-14', 'Laptop');
  await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 4000000 });
  const [invoice] = await app.api.get('/debts');
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 4000000, account_id: account.id, date: '2026-03-01' });
});
after(() => app.close());

test('ringkasan tahunan & perbandingan dengan tahun lalu', async () => {
  const report = await app.api.get('/reports/yearly?year=2026');
  assert.equal(report.totals.income, 20000000);
  assert.equal(report.totals.expense, 8500000);
  assert.equal(report.totals.net, 11500000);
  assert.equal(report.totals.savingsRate, 57.5);
  assert.equal(report.totals.activeMonths, 3);
  assert.equal(report.changes.income, 150); // 8jt → 20jt
  assert.deepEqual(report.years, [2026, 2025]);
});

test('12 bulan lengkap, termasuk bulan kosong', async () => {
  const { months } = await app.api.get('/reports/yearly?year=2026');
  assert.equal(months.length, 12);
  assert.equal(months[0].month, '2026-01');
  assert.deepEqual([months[1].income, months[1].expense], [8000000, 5500000]);
  assert.equal(months[11].income, 0);
});

test('kategori, klien, transaksi terbesar & bulan paling boros', async () => {
  const report = await app.api.get('/reports/yearly?year=2026');
  assert.deepEqual(report.expenseByCategory.map((row) => [row.name, row.percent]), [['Belanja', 52.9], ['Makan & Minum', 47.1]]);
  assert.deepEqual(report.incomeByClient.map((row) => [row.name, row.total]), [['PT Maju', 4000000]]);
  assert.equal(report.topExpenses[0].note, 'Laptop');
  assert.equal(report.extremes.mostExpensive.month, '2026-02');
  assert.equal(report.extremes.mostFrugal.month, '2026-03');
});

test('tahun tanpa data tetap aman', async () => {
  const report = await app.api.get('/reports/yearly?year=2030');
  assert.equal(report.totals.income, 0);
  assert.equal(report.totals.savingsRate, null);
  assert.equal(report.extremes, null);
});
