import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 10000000 });
});
after(() => app.close());

test('pajak tidak aktif selama mode gaji tetap atau tarif 0', async () => {
  const summary = await app.api.get('/summary?month=2026-10');
  assert.equal(summary.tax, null);
});

test('aktifkan pajak: kategori Freelance & Pajak dibuat otomatis', async () => {
  const settings = await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance', tax_rate: 2.5 });
  assert.equal(settings.tax_rate, 2.5);
  const freelance = await categoryId(app.api, 'Freelance');
  assert.deepEqual(settings.tax_category_ids, [freelance]);
  assert.ok(await categoryId(app.api, 'Pajak'));
});

test('hanya pemasukan kategori kena pajak yang dihitung', async () => {
  const freelance = await categoryId(app.api, 'Freelance');
  const bonus = await categoryId(app.api, 'Bonus');
  await app.api.post('/transactions', { kind: 'income', amount: 10000000, account_id: account.id, category_id: freelance, date: '2026-03-10' });
  await app.api.post('/transactions', { kind: 'income', amount: 4000000, account_id: account.id, category_id: freelance, date: '2026-10-05' });
  await app.api.post('/transactions', { kind: 'income', amount: 1000000, account_id: account.id, category_id: bonus, date: '2026-10-06' });

  const { tax } = await app.api.get('/summary?month=2026-10');
  assert.equal(tax.taxableIncome, 14000000);
  assert.equal(tax.owed, 350000); // 2,5% × 14jt
  assert.equal(tax.outstanding, 350000);
  assert.equal(tax.periodReserve, 100000); // 2,5% × 4jt bulan ini
});

test('pembayaran invoice klien otomatis kena pajak', async () => {
  await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 2000000 });
  const [invoice] = await app.api.get('/debts');
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 2000000, account_id: account.id, date: '2026-10-20' });
  const { tax } = await app.api.get('/summary?month=2026-10');
  assert.equal(tax.owed, 400000); // 2,5% × 16jt
});

test('bayar pajak mengurangi sisa dana pajak & tercatat sebagai pengeluaran Pajak', async () => {
  await app.api.post('/tax/pay', { amount: 150000, account_id: account.id, date: '2026-10-25' });
  const status = await app.api.get('/tax?year=2026');
  assert.equal(status.paid, 150000);
  assert.equal(status.outstanding, 250000);
  const [expense] = await app.api.get('/transactions?month=2026-10&kind=expense');
  assert.equal(expense.category_name, 'Pajak');
});

test('dana pajak tidak dihitung sebagai uang yang bisa dipakai', async () => {
  const summary = await app.api.get('/summary?month=2026-10');
  const expected = (summary.totalBalance - summary.tax.outstanding) / summary.savings.monthlyNeed;
  assert.ok(Math.abs(summary.runwayMonths - expected) < 1e-9);
});

test('persentase pajak di luar batas ditolak', async () => {
  const { status } = await app.call('PUT', '/settings', { month_start_day: 1, income_mode: 'freelance', tax_rate: 80 });
  assert.equal(status, 400);
});
