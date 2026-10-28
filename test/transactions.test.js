import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let cash;
let bank;
before(async () => {
  app = await startTestApp();
  cash = await app.api.post('/accounts', { name: 'Dompet', type: 'cash', initial_balance: 100000 });
  bank = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 1000000 });
});
after(() => app.close());

const balanceOf = async (account) => (await app.api.get('/accounts')).find((a) => a.id === account.id).balance;

test('saldo = saldo awal + pemasukan − pengeluaran ± transfer', async () => {
  const food = await categoryId(app.api, 'Makan & Minum');
  const salary = await categoryId(app.api, 'Gaji');
  await app.api.post('/transactions', { kind: 'income', amount: 5000000, account_id: bank.id, category_id: salary, date: '2026-10-01' });
  await app.api.post('/transactions', { kind: 'expense', amount: 25000, account_id: cash.id, category_id: food, date: '2026-10-02' });
  await app.api.post('/transactions', { kind: 'transfer', amount: 200000, account_id: bank.id, to_account_id: cash.id, date: '2026-10-03' });

  assert.equal(await balanceOf(cash), 100000 - 25000 + 200000);
  assert.equal(await balanceOf(bank), 1000000 + 5000000 - 200000);
});

test('transfer tidak dihitung sebagai pemasukan/pengeluaran', async () => {
  const summary = await app.api.get('/summary?month=2026-10');
  assert.equal(summary.income, 5000000);
  assert.equal(summary.expense, 25000);
});

test('sesuaikan saldo mencatat selisihnya', async () => {
  const { difference } = await app.api.post(`/accounts/${cash.id}/adjust`, { actual_balance: 250000 });
  assert.equal(difference, 250000 - 275000);
  assert.equal(await balanceOf(cash), 250000);
});

test('edit transaksi & akun', async () => {
  const [expense] = await app.api.get('/transactions?month=2026-10&kind=expense');
  await app.api.put(`/transactions/${expense.id}`, { ...expense, amount: 30000, note: 'Bakso + es teh' });
  const [edited] = await app.api.get('/transactions?month=2026-10&kind=expense');
  assert.equal(edited.amount, 30000);
  assert.equal(edited.note, 'Bakso + es teh');

  await app.api.put(`/accounts/${bank.id}`, { name: 'BCA Utama', type: 'bank', initial_balance: 2000000 });
  const updated = (await app.api.get('/accounts')).find((a) => a.id === bank.id);
  assert.equal(updated.name, 'BCA Utama');
  assert.equal(updated.balance, 2000000 + 5000000 - 200000);
});

test('validasi: transfer ke akun yang sama & transaksi tanpa kategori ditolak', async () => {
  const sameAccount = await app.call('POST', '/transactions', { kind: 'transfer', amount: 1, account_id: cash.id, to_account_id: cash.id, date: '2026-10-05' });
  assert.equal(sameAccount.status, 400);
  const noCategory = await app.call('POST', '/transactions', { kind: 'expense', amount: 1, account_id: cash.id, date: '2026-10-05' });
  assert.equal(noCategory.status, 400);
});

test('transaksi penyesuaian: nominal & tanggal bisa diedit, jenisnya tetap', async () => {
  const [adjustment] = (await app.api.get('/transactions?month=' + new Date().toISOString().slice(0, 7))).filter((t) => t.kind === 'adjustment');
  await app.api.put(`/transactions/${adjustment.id}`, { kind: 'expense', amount: -10000, account_id: cash.id, date: adjustment.date });
  const [edited] = (await app.api.get('/transactions?month=' + new Date().toISOString().slice(0, 7))).filter((t) => t.id === adjustment.id);
  assert.equal(edited.kind, 'adjustment');
  assert.equal(edited.amount, -10000);
});

test('jenis transaksi yang terhubung (invoice, tagihan, wishlist) tidak bisa diganti', async () => {
  const freelance = await app.api.post('/categories', { name: 'Proyek', kind: 'income' });
  await app.api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 1000000 });
  const invoice = (await app.api.get('/debts')).find((debt) => debt.counterparty === 'PT Maju');
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 1000000, account_id: bank.id, date: '2026-10-20' });
  const [payment] = (await app.api.get('/transactions?month=2026-10&kind=income')).filter((t) => t.debt_id === invoice.id);
  assert.equal(payment.linked_to, 'debt');

  const body = { ...payment, account_id: bank.id, category_id: freelance.id };
  const changed = await app.call('PUT', `/transactions/${payment.id}`, { ...body, kind: 'expense' });
  assert.equal(changed.status, 400);
  assert.match(changed.data.error, /tidak bisa diubah/);

  // Nominal & tanggal tetap boleh diubah.
  await app.api.put(`/transactions/${payment.id}`, { ...body, amount: 900000, date: '2026-10-21' });
  assert.equal((await app.api.get('/debts')).find((debt) => debt.id === invoice.id).remaining, 100000);

  // Transaksi biasa tetap bebas ganti jenis.
  const [plain] = await app.api.get('/transactions?month=2026-10&kind=expense');
  assert.equal(plain.linked_to, null);
});

test('biaya admin transfer dipotong dari akun pengirim sebagai pengeluaran', async () => {
  const bca = await app.api.post('/accounts', { name: 'BCA Fee', type: 'bank', initial_balance: 1000000 });
  const gopay = await app.api.post('/accounts', { name: 'GoPay Fee', type: 'ewallet', initial_balance: 0 });
  const balance = async (id) => (await app.api.get('/accounts')).find((a) => a.id === id).balance;

  const transfer = await app.api.post('/transactions', {
    kind: 'transfer', amount: 100000, account_id: bca.id, to_account_id: gopay.id, date: '2026-10-10', fee: 1000,
  });
  assert.equal(await balance(bca.id), 899000);
  assert.equal(await balance(gopay.id), 100000);
  const rows = await app.api.get('/transactions?month=2026-10');
  assert.equal(rows.find((t) => t.id === transfer.id).fee, 1000);
  const fee = rows.find((t) => t.fee_of === transfer.id);
  assert.equal(fee.kind, 'expense');
  assert.equal(fee.category_name, 'Biaya admin');
  assert.deepEqual(await app.api.get(`/transactions/transfer-fee?from=${bca.id}&to=${gopay.id}`), { fee: 1000 });

  // Edit biaya, lalu hapus biaya.
  const body = { kind: 'transfer', amount: 100000, account_id: bca.id, to_account_id: gopay.id, date: '2026-10-10' };
  await app.api.put(`/transactions/${transfer.id}`, { ...body, fee: 2500 });
  assert.equal(await balance(bca.id), 897500);
  await app.api.put(`/transactions/${transfer.id}`, { ...body, fee: 0 });
  assert.equal(await balance(bca.id), 900000);

  // Hapus transfer: biayanya ikut terhapus.
  await app.api.put(`/transactions/${transfer.id}`, { ...body, fee: 1000 });
  await app.api.delete(`/transactions/${transfer.id}`);
  assert.equal(await balance(bca.id), 1000000);
});

test('pengeluaran biasa (bayar ke rekening lain) bisa punya biaya admin', async () => {
  const bca = await app.api.post('/accounts', { name: 'BCA Exp Fee', type: 'bank', initial_balance: 500000 });
  const category = (await app.api.get('/categories')).find((c) => c.name === 'Belanja').id;
  const expense = await app.api.post('/transactions', {
    kind: 'expense', amount: 200000, account_id: bca.id, category_id: category, date: '2026-10-12', note: 'Bayar toko online', fee: 2500,
  });
  assert.equal((await app.api.get('/accounts')).find((a) => a.id === bca.id).balance, 297500);
  const fee = (await app.api.get('/transactions?month=2026-10')).find((t) => t.fee_of === expense.id);
  assert.equal(fee.note, 'Biaya admin: Bayar toko online');
  assert.equal((await app.api.get('/transactions?month=2026-10')).find((t) => t.id === expense.id).fee, 2500);
});

test('filter transaksi: kategori, rentang nominal, foto, dan urutan', async () => {
  const acc = await app.api.post('/accounts', { name: 'Filter Acc', type: 'bank', initial_balance: 1000000 });
  const cats = await app.api.get('/categories');
  const food = cats.find((c) => c.name === 'Makan & Minum').id;
  const shop = cats.find((c) => c.name === 'Belanja').id;
  for (const [amount, category] of [[15000, food], [80000, food], [250000, shop]]) {
    await app.api.post('/transactions', { kind: 'expense', amount, account_id: acc.id, category_id: category, date: '2026-07-05' });
  }
  const list = (query) => app.api.get(`/transactions?start=2026-07-01&end=2026-07-31&account_id=${acc.id}&${query}`);
  assert.deepEqual((await list(`category_id=${food}`)).map((t) => t.amount).sort((a, b) => a - b), [15000, 80000]);
  assert.deepEqual((await list('min=50000&max=100000')).map((t) => t.amount), [80000]);
  assert.deepEqual((await list('sort=largest')).map((t) => t.amount), [250000, 80000, 15000]);
  assert.deepEqual((await list('sort=smallest')).map((t) => t.amount), [15000, 80000, 250000]);
  assert.equal((await list('photos=yes')).length, 0);
  assert.equal((await list('photos=no')).length, 3);
});
