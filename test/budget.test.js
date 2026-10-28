import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';
import { currentMonth, shiftMonth } from '../public/js/format.js'; // bukan server/: jangan sentuh db sebelum helper

let app;
let food;
let transport;
const month = currentMonth(1);
const monthsAgo = (n) => `${shiftMonth(month, -n)}-15`;

before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  food = await categoryId(app.api, 'Makan & Minum');
  transport = await categoryId(app.api, 'Transportasi');
  const salary = await categoryId(app.api, 'Gaji');
  // 3 bulan terakhir: pemasukan 10jt/bulan; makan 1,8jt, 2,1jt, 2,4jt (bulan lalu)
  for (const [n, spent] of [[3, 1800000], [2, 2100000], [1, 2400000]]) {
    await app.api.post('/transactions', { kind: 'income', amount: 10000000, account_id: account.id, category_id: salary, date: monthsAgo(n) });
    await app.api.post('/transactions', { kind: 'expense', amount: spent, account_id: account.id, category_id: food, date: monthsAgo(n) });
  }
});
after(() => app.close());

test('saran anggaran dari riwayat belanja & panduan umum', async () => {
  const suggestions = await app.api.get(`/categories/${food}/budget-suggestions`);
  assert.equal(suggestions.history.length, 6);
  assert.equal(suggestions.average3, 2100000);
  assert.equal(suggestions.referenceIncome, 10000000);
  assert.equal(suggestions.averagePercent, 21);
  assert.deepEqual(suggestions.options.map((option) => [option.key, option.amount]), [
    ['average', 2100000], ['save', 1890000], ['last', 2400000],
  ]);
  assert.deepEqual(suggestions.guideline, { min: 15, max: 25, suggested: 20 });
});

test('anggaran persen dihitung dari rata-rata pemasukan', async () => {
  await app.api.put(`/categories/${transport}/budget`, { budget_percent: '7,5' });
  const { categories, budgetIncome } = await app.api.get(`/summary?month=${month}`);
  const row = categories.find((category) => category.id === transport);
  assert.equal(budgetIncome, 10000000);
  assert.equal(row.budget_percent, 7.5);
  assert.equal(row.monthly_budget, 750000);
  assert.equal(row.fixed_budget, null);
});

test('ganti ke nominal menghapus persen (hanya satu yang berlaku)', async () => {
  await app.api.put(`/categories/${transport}/budget`, { monthly_budget: 600000 });
  const { categories } = await app.api.get(`/summary?month=${month}`);
  const row = categories.find((category) => category.id === transport);
  assert.equal(row.budget_percent, null);
  assert.equal(row.monthly_budget, 600000);
});

test('persen di luar batas ditolak, kosong = hapus anggaran', async () => {
  assert.equal((await app.call('PUT', `/categories/${transport}/budget`, { budget_percent: 150 })).status, 400);
  await app.api.put(`/categories/${transport}/budget`, {});
  const { categories } = await app.api.get(`/summary?month=${month}`);
  assert.equal(categories.find((category) => category.id === transport).monthly_budget, null);
});
