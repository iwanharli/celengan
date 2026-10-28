import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';
import { annualTax, progressiveTax, taxShareOf } from '../public/js/tax-calc.js';

test('tarif progresif PPh (5/15/25/30/35%)', () => {
  assert.equal(progressiveTax(0), 0);
  assert.equal(progressiveTax(60000000), 3000000);
  assert.equal(progressiveTax(100000000), 3000000 + 6000000);
  assert.equal(progressiveTax(300000000), 3000000 + 28500000 + 12500000);
});

test('PPh Final 0,5%: Rp500 juta pertama bebas', () => {
  const final = { method: 'final' };
  assert.equal(annualTax(400000000, final), 0);
  assert.equal(annualTax(700000000, final), 1000000); // 0,5% × 200jt
  // Bagian pajak sebuah pemasukan tergantung pemasukan sebelumnya di tahun itu.
  assert.equal(taxShareOf(100000000, 450000000, final), 250000); // hanya 50jt yang melewati batas
});

test('NPPN: norma × bruto − PTKP, lalu tarif progresif', () => {
  const nppn = { method: 'nppn', norma: 50, ptkp: 'TK/0' };
  assert.equal(annualTax(100000000, nppn), 0); // neto 50jt < PTKP 54jt
  // 240jt × 50% = 120jt − 54jt = PKP 66jt → 5% × 60jt + 15% × 6jt
  assert.equal(annualTax(240000000, nppn), 3000000 + 900000);
  assert.equal(annualTax(240000000, { ...nppn, ptkp: 'K/1' }), Math.round(57000000 * 0.05));
});

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('pengaturan NPPN wajib isi norma; PPh 21 dipotong klien mengurangi sisa dana pajak', async () => {
  const bad = await app.call('PUT', '/settings', { month_start_day: 1, income_mode: 'freelance', tax_method: 'nppn' });
  assert.equal(bad.status, 400);
  const settings = await app.api.put('/settings', {
    month_start_day: 1, income_mode: 'freelance', tax_method: 'nppn', tax_norma: 50, tax_ptkp: 'TK/0',
  });
  assert.equal(settings.tax_method, 'nppn');

  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const freelance = await categoryId(app.api, 'Freelance');
  // Diterima 237,5jt setelah dipotong PPh 21 2,5jt → bruto 240jt.
  await app.api.post('/transactions', {
    kind: 'income', amount: 237500000, account_id: account.id, category_id: freelance, date: '2026-03-10', tax_withheld: 2500000,
  });
  const balance = (await app.api.get('/accounts')).find((a) => a.id === account.id).balance;
  assert.equal(balance, 237500000);

  const status = await app.api.get('/tax?year=2026');
  assert.equal(status.taxableIncome, 240000000);
  assert.equal(status.owed, 3900000);
  assert.equal(status.withheld, 2500000);
  assert.equal(status.outstanding, 1400000);
});

test('invoice: potongan PPh 21 ikut melunasi invoice', async () => {
  const account = await app.api.post('/accounts', { name: 'Jago', type: 'bank', initial_balance: 0 });
  const invoice = await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 10000000 });
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 9750000, account_id: account.id, date: '2026-04-01', tax_withheld: 250000 });
  const debt = (await app.api.get('/debts')).find((d) => d.id === invoice.id);
  assert.equal(debt.remaining, 0);
  assert.equal((await app.api.get('/accounts')).find((a) => a.id === account.id).balance, 9750000);
});

test('potongan PPh 21 pembayaran invoice bisa diubah lewat edit', async () => {
  const account = await app.api.post('/accounts', { name: 'Blu', type: 'bank', initial_balance: 0 });
  const invoice = await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'CV Kecil', principal: 4000000 });
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 4000000, account_id: account.id, date: '2026-05-01' });
  const [payment] = (await app.api.get('/transactions?start=2026-05-01&end=2026-05-31')).filter((t) => t.debt_id === invoice.id);
  await app.api.put(`/transactions/${payment.id}`, { amount: 3900000, account_id: account.id, date: '2026-05-01', tax_withheld: 100000 });
  const debt = (await app.api.get('/debts')).find((d) => d.id === invoice.id);
  assert.equal(debt.remaining, 0);
  const updated = (await app.api.get('/transactions?start=2026-05-01&end=2026-05-31')).find((t) => t.id === payment.id);
  assert.equal(updated.tax_withheld, 100000);
});

test('ringkasan SPT: per klien, per bulan, dan PDF bisa diunduh', async () => {
  const report = await app.api.get('/tax/report?year=2026');
  assert.ok(report.clients.length >= 1);
  const maju = report.clients.find((c) => c.client === 'PT Maju');
  assert.equal(maju.gross, 10000000);
  assert.equal(maju.withheld, 250000);
  assert.ok(report.months.some((m) => m.month === '2026-03'));

  const pdf = await app.call('GET', '/tax/report?year=2026&format=pdf');
  assert.equal(pdf.status, 200);
});
