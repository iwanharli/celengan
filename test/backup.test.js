import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let backup;
before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 5000000 });
  await app.api.post('/transactions', { kind: 'expense', amount: 25000, account_id: account.id, category_id: await categoryId(app.api, 'Makan & Minum'), date: '2026-10-02' });
  await app.api.post('/debts', { direction: 'payable', type: 'paylater', counterparty: 'SPayLater', principal: 1500000, total_amount: 1800000, tenor: 6, first_due: '2026-11-05', account_id: account.id });
  const wish = await app.api.post('/wishlist', { name: 'Sepatu', price: 900000 });
  await app.api.post(`/wishlist/${wish.id}/save`, { amount: 300000 });
  await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance' });
});
after(() => app.close());

const snapshot = async () => ({
  accounts: await app.api.get('/accounts'),
  transactions: await app.api.get('/transactions?month=2026-10'),
  debts: await app.api.get('/debts'),
  bills: await app.api.get('/bills'),
  wishlist: await app.api.get('/wishlist'),
  settings: await app.api.get('/settings'),
});

test('backup berisi semua tabel data, tanpa data login', async () => {
  backup = await app.exportData();
  assert.equal(backup.app, 'catat-keuangan');
  for (const table of ['categories', 'accounts', 'transactions', 'debts', 'debt_installments', 'bills', 'wishlist_items', 'wishlist_events']) {
    assert.ok(Array.isArray(backup.data[table]), table);
  }
  assert.equal(backup.data.debt_installments.length, 6);
  assert.equal(backup.settings.income_mode, 'freelance');
  assert.equal(JSON.stringify(backup).includes('password'), false);
});

test('mulai dari nol butuh konfirmasi HAPUS, kategori tetap ada', async () => {
  assert.equal((await app.call('POST', '/backup/reset', { confirm: 'hapus dong' })).status, 400);
  await app.api.post('/backup/reset', { confirm: 'HAPUS' });
  assert.equal((await app.api.get('/accounts')).length, 0);
  assert.equal((await app.api.get('/debts')).length, 0);
  assert.equal((await app.api.get('/wishlist')).length, 0);
  assert.ok((await app.api.get('/categories')).length >= 12);
});

test('restore mengembalikan semua data persis seperti semula', async () => {
  const before = { ...backup };
  await app.restoreData(before);
  const restored = await snapshot();
  assert.equal(restored.accounts[0].balance, 5000000 - 25000 + 1500000);
  assert.equal(restored.transactions.length, 2);
  assert.equal(restored.debts[0].installments.length, 6);
  assert.equal(restored.bills.length, 1);
  assert.equal(restored.wishlist[0].saved, 300000);
  assert.equal(restored.wishlist[0].events.length, 2);
  assert.equal(restored.settings.income_mode, 'freelance');
});

test('setelah restore, data baru tetap bisa ditambahkan (penomoran id lanjut)', async () => {
  const account = await app.api.post('/accounts', { name: 'GoPay', type: 'ewallet', initial_balance: 0 });
  assert.ok(account.id > 1);
});

test('file yang bukan backup ditolak', async () => {
  await assert.rejects(app.restoreData({ hello: 'world' }), /bukan backup/);
  assert.equal((await app.api.get('/accounts')).length, 2); // data tidak berubah
});

test('unduh & pulihkan backup tidak tersedia lagi dari aplikasi', async () => {
  assert.equal((await app.call('GET', '/backup')).status, 404);
  assert.equal((await app.call('POST', '/backup/restore', backup)).status, 404);
});
