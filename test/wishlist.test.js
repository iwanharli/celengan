import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
let shopping;
let item;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 20000000 });
  shopping = await categoryId(app.api, 'Belanja');
  item = await app.api.post('/wishlist', { name: 'Headphone', price: 1200000, priority: 'high', emoji: '1f3a7' });
});
after(() => app.close());

const getItem = async () => (await app.api.get('/wishlist')).find((w) => w.id === item.id);
const balance = async () => (await app.api.get('/accounts')).find((a) => a.id === account.id).balance;
const total = async () => (await app.api.get('/accounts')).reduce((sum, a) => sum + a.balance, 0);
const goalBalance = async () => {
  const { account_id: id } = await getItem();
  return (await app.api.get('/accounts')).find((a) => a.id === id).balance;
};

test('sisihkan & ambil kembali, tidak boleh melebihi yang disisihkan', async () => {
  await app.api.post(`/wishlist/${item.id}/save`, { amount: 500000 });
  await app.api.post(`/wishlist/${item.id}/save`, { amount: -100000 });
  assert.equal((await getItem()).saved, 400000);
  const { status } = await app.call('POST', `/wishlist/${item.id}/save`, { amount: -500000 });
  assert.equal(status, 400);
  // Uang benar-benar pindah ke akun impian; total uang tetap sama.
  assert.equal(await balance(), 20000000 - 400000);
  assert.equal(await goalBalance(), 400000);
  assert.equal(await total(), 20000000);
});

test('membuat wishlist otomatis membuat akun tabungan impian', async () => {
  const { account_id: id } = await getItem();
  const goal = (await app.api.get('/accounts')).find((a) => a.id === id);
  assert.equal(goal.type, 'goal');
  assert.equal(goal.name, '🎁 Headphone');
});

test('beli → status terbeli & tercatat sebagai pengeluaran', async () => {
  await app.api.post(`/wishlist/${item.id}/buy`, { amount: 1100000, account_id: account.id, category_id: shopping, date: '2026-10-20' });
  const bought = await getItem();
  assert.equal(bought.status, 'bought');
  assert.equal(bought.paid_amount, 1100000);
  assert.equal(await balance(), 20000000 - 1100000);
  const { status } = await app.call('POST', `/wishlist/${item.id}/buy`, { amount: 1, account_id: account.id, category_id: shopping, date: '2026-10-20' });
  assert.equal(status, 400); // tidak bisa dibeli dua kali
});

test('batalkan pembelian → transaksi dihapus, kembali ke diinginkan', async () => {
  await app.api.post(`/wishlist/${item.id}/unbuy`, { reason: 'Rusak, dikembalikan' });
  const reverted = await getItem();
  assert.equal(reverted.status, 'wanted');
  assert.equal(reverted.transaction_id, null);
  // Uang pembelian kembali ke tabungan impian, total uang utuh lagi.
  assert.equal(await goalBalance(), 1100000);
  assert.equal(await total(), 20000000);
});

test('menghapus transaksi pembelian dari halaman Transaksi juga mengembalikan barang', async () => {
  await app.api.post(`/wishlist/${item.id}/buy`, { amount: 1200000, account_id: account.id, category_id: shopping, date: '2026-10-21' });
  const { transaction_id: transactionId } = await getItem();
  await app.api.delete(`/transactions/${transactionId}`);
  assert.equal((await getItem()).status, 'wanted');
});

test('tidak jadi beli → dana dilepas; bisa diinginkan lagi', async () => {
  await app.api.post(`/wishlist/${item.id}/cancel`, { reason: 'Belum butuh' });
  const cancelled = await getItem();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.saved, 0);
  assert.equal(await balance(), 20000000); // sisa tabungan dikembalikan ke akun utama
  assert.equal(cancelled.cancel_reason, 'Belum butuh');

  const { status } = await app.call('POST', `/wishlist/${item.id}/save`, { amount: 1000 });
  assert.equal(status, 400); // barang dibatalkan tidak bisa disisihkan

  await app.api.post(`/wishlist/${item.id}/restore`);
  assert.equal((await getItem()).status, 'wanted');
});

test('semua langkah tercatat di riwayat', async () => {
  const { events } = await getItem();
  assert.deepEqual(events.map((event) => event.type).reverse(), [
    'created', 'saved', 'withdrawn', 'bought', 'purchase_cancelled', 'bought', 'purchase_cancelled', 'cancelled', 'restored',
  ]);
  assert.equal(events.find((event) => event.type === 'cancelled').amount, 1200000); // yang dikembalikan
});

test('tidak bisa menyisihkan melebihi saldo akun asal', async () => {
  const small = await app.api.post('/accounts', { name: 'Dompet', type: 'cash', initial_balance: 50000 });
  const wish = await app.api.post('/wishlist', { name: 'Sepatu', price: 900000 });
  const { status, data } = await app.call('POST', `/wishlist/${wish.id}/save`, { amount: 100000, account_id: small.id });
  assert.equal(status, 400);
  assert.match(data.error, /tidak cukup/);
});
