import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('akun bank menyimpan nama bank, no. rekening (angka saja) & atas nama', async () => {
  const account = await app.api.post('/accounts', {
    name: 'BCA Gaji', type: 'bank', initial_balance: 1000000,
    provider: 'BCA', account_number: '1234-5678 90', holder_name: ' Iwan Harli ', note: 'Rekening gaji',
  });
  assert.equal(account.provider, 'BCA');
  assert.equal(account.account_number, '1234567890');
  assert.equal(account.holder_name, 'Iwan Harli');
  const [listed] = await app.api.get('/accounts');
  assert.equal(listed.account_number, '1234567890'); // ikut tampil lewat view saldo
  assert.equal(listed.balance, 1000000);
});

test('validasi panjang nomor rekening & nomor HP', async () => {
  const shortBank = await app.call('POST', '/accounts', { name: 'X', type: 'bank', account_number: '123' });
  assert.equal(shortBank.status, 400);
  assert.match(shortBank.data.error, /rekening/);
  const shortPhone = await app.call('POST', '/accounts', { name: 'X', type: 'ewallet', account_number: '0812' });
  assert.equal(shortPhone.status, 400);
  assert.match(shortPhone.data.error, /HP/);
});

test('e-wallet dengan nomor HP; tunai tidak menyimpan nomor', async () => {
  const gopay = await app.api.post('/accounts', { name: 'GoPay', type: 'ewallet', provider: 'GoPay', account_number: '0812 3456 7890' });
  assert.equal(gopay.account_number, '081234567890');
  const cash = await app.api.post('/accounts', { name: 'Dompet', type: 'cash', provider: 'Dompet', account_number: '99999', holder_name: 'X' });
  assert.equal(cash.account_number, null);
  assert.equal(cash.holder_name, null);
});

test('edit detail akun', async () => {
  const [bca] = await app.api.get('/accounts');
  await app.api.put(`/accounts/${bca.id}`, { ...bca, account_number: '9876543210', note: '' });
  const [edited] = await app.api.get('/accounts');
  assert.equal(edited.account_number, '9876543210');
  assert.equal(edited.note, null);
  assert.equal(edited.initial_balance, 1000000);
});

test('detail akun ikut masuk backup', async () => {
  const backup = await app.exportData();
  assert.equal(backup.data.accounts[0].account_number, '9876543210');
  assert.equal(backup.data.accounts[0].provider, 'BCA');
});

test('akun utama: hanya satu, tampil paling atas, bisa dilepas', async () => {
  const accounts = await app.api.get('/accounts');
  const [first, second] = accounts;
  await app.api.put(`/accounts/${second.id}/primary`, {});
  await app.api.put(`/accounts/${first.id}/primary`, {});
  let list = await app.api.get('/accounts');
  assert.deepEqual(list.filter((a) => a.is_primary).map((a) => a.id), [first.id]);
  assert.equal(list[0].id, first.id);
  await app.api.put(`/accounts/${first.id}/primary`, { primary: false });
  list = await app.api.get('/accounts');
  assert.equal(list.filter((a) => a.is_primary).length, 0);
});

test('saldo awal bisa dicatat sebagai pemasukan', async () => {
  const salary = (await app.api.get('/categories')).find((c) => c.name === 'Gaji');
  const account = await app.api.post('/accounts', {
    name: 'Jago', type: 'bank', initial_balance: 2500000, income: { category_id: salary.id, date: '2026-10-25' },
  });
  assert.equal(account.initial_balance, 0);
  const listed = (await app.api.get('/accounts')).find((a) => a.id === account.id);
  assert.equal(listed.balance, 2500000);
  const summary = await app.api.get('/summary?month=2026-10');
  assert.equal(summary.income, 2500000);
  const [income] = await app.api.get('/transactions?month=2026-10&kind=income');
  assert.equal(income.note, 'Saldo awal Jago');
});

test('tanpa pilihan itu, saldo awal tidak dihitung pemasukan', async () => {
  await app.api.post('/accounts', { name: 'Seabank', type: 'bank', initial_balance: 1000000 });
  assert.equal((await app.api.get('/summary?month=2026-10')).income, 2500000);
});

test('selisih penyesuaian bisa dicatat sebagai pengeluaran / pemasukan', async () => {
  const dompet = await app.api.post('/accounts', { name: 'Dompet Adj', type: 'cash', initial_balance: 300000 });
  const food = (await app.api.get('/categories')).find((c) => c.name === 'Makan & Minum');
  const salary = (await app.api.get('/categories')).find((c) => c.name === 'Gaji');
  const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const before = await app.api.get(`/summary?month=${month}`);

  assert.equal((await app.call('POST', `/accounts/${dompet.id}/adjust`, { actual_balance: 250000, record_as: 'flow' })).status, 400);
  await app.api.post(`/accounts/${dompet.id}/adjust`, { actual_balance: 250000, record_as: 'flow', category_id: food.id });
  await app.api.post(`/accounts/${dompet.id}/adjust`, { actual_balance: 270000, record_as: 'flow', category_id: salary.id });

  const after = await app.api.get(`/summary?month=${month}`);
  assert.equal(after.expense - before.expense, 50000);
  assert.equal(after.income - before.income, 20000);
  assert.equal((await app.api.get('/accounts')).find((a) => a.id === dompet.id).balance, 270000);
});

test('akun e-money: nomor kartu 16 angka, tanpa atas nama', async () => {
  const flazz = await app.api.post('/accounts', {
    name: 'Flazz', type: 'emoney', initial_balance: 150000, provider: 'BCA Flazz', account_number: '6019 0012 3456 7890', holder_name: 'Siapa',
  });
  assert.equal(flazz.type, 'emoney');
  assert.equal(flazz.account_number, '6019001234567890');
  assert.equal(flazz.holder_name, null);
  const bad = await app.call('POST', '/accounts', { name: 'E-money', type: 'emoney', initial_balance: 0, account_number: '12345' });
  assert.equal(bad.status, 400);
});
