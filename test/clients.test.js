import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
let freelance;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance', tax_rate: 2.5 });
  freelance = await categoryId(app.api, 'Freelance');
});
after(() => app.close());

test('proyek yang langsung dibayar dicatat sebagai pemasukan dengan nama klien', async () => {
  const income = await app.api.post('/transactions', {
    kind: 'income', amount: 3000000, account_id: account.id, category_id: freelance,
    date: '2026-05-10', note: 'Logo', client: '  Toko Sinar ',
  });
  assert.equal(income.client, 'Toko Sinar');
  const [listed] = await app.api.get('/transactions?month=2026-05&q=sinar');
  assert.equal(listed.id, income.id);
});

test('nama klien diabaikan untuk pengeluaran', async () => {
  const expense = await app.api.post('/transactions', {
    kind: 'expense', amount: 1000, account_id: account.id, category_id: await categoryId(app.api, 'Lainnya'),
    date: '2026-05-11', client: 'Harusnya kosong',
  });
  assert.equal(expense.client, null);
});

test('laporan per klien menggabungkan invoice & pemasukan langsung', async () => {
  await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 5000000 });
  const [invoice] = await app.api.get('/debts');
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 5000000, account_id: account.id, date: '2026-06-01' });
  await app.api.post('/transactions', {
    kind: 'income', amount: 2000000, account_id: account.id, category_id: freelance, date: '2026-07-01', client: 'PT Maju',
  });

  const report = await app.api.get('/reports/yearly?year=2026');
  assert.deepEqual(report.incomeByClient.map((row) => [row.name, row.total, row.count]), [
    ['PT Maju', 7000000, 2], ['Toko Sinar', 3000000, 1],
  ]);
  // Semua proyek (invoice maupun langsung) ikut dana pajak.
  assert.equal((await app.api.get('/tax?year=2026')).owed, 250000);
});

test('saran nama klien dari pemasukan & invoice', async () => {
  const names = await app.api.get('/transactions/clients');
  assert.deepEqual(names.sort(), ['PT Maju', 'Toko Sinar']);
});

test('ganti nama klien di invoice ikut mengubah pemasukannya', async () => {
  const [invoice] = await app.api.get('/debts');
  await app.api.put(`/debts/${invoice.id}`, { counterparty: 'PT Maju Jaya', type: 'invoice', principal: 5000000 });
  const report = await app.api.get('/reports/yearly?year=2026');
  assert.ok(report.incomeByClient.some((row) => row.name === 'PT Maju Jaya' && row.total === 5000000));
});
