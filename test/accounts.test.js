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
