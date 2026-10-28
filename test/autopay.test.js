import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

const daysFromToday = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
};
const balanceOf = async (id) => (await app.api.get('/accounts')).find((a) => a.id === id).balance;

test('tagihan potong otomatis dibayar saat jatuh tempo kalau saldo cukup', async () => {
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 200000 });
  const bill = await app.api.post('/bills', {
    name: 'Netflix', amount: 65000, frequency: 'monthly', next_due: daysFromToday(0),
    category_id: await categoryId(app.api, 'Hiburan'), account_id: account.id, auto_pay: true,
  });
  const [listed] = await app.api.get('/bills');
  assert.equal(listed.next_due > daysFromToday(0), true); // sudah maju ke periode berikutnya
  assert.equal(listed.auto_pay_blocked, false);
  assert.equal(await balanceOf(account.id), 135000);
  await app.api.get('/bills'); // memuat ulang tidak membayar dua kali
  assert.equal(await balanceOf(account.id), 135000);
  await app.api.delete(`/bills/${bill.id}`);
});

test('saldo tidak cukup: tidak dipotong dan ditandai saldo kurang', async () => {
  const account = await app.api.post('/accounts', { name: 'GoPay', type: 'ewallet', initial_balance: 10000 });
  const bill = await app.api.post('/bills', {
    name: 'Spotify', amount: 55000, frequency: 'monthly', next_due: daysFromToday(-2),
    category_id: await categoryId(app.api, 'Hiburan'), account_id: account.id, auto_pay: true,
  });
  let listed = (await app.api.get('/bills')).find((b) => b.id === bill.id);
  assert.equal(listed.auto_pay_blocked, true);
  assert.equal(listed.next_due, daysFromToday(-2));
  assert.equal(await balanceOf(account.id), 10000);

  // Setelah saldo cukup, tagihan langsung terpotong.
  await app.api.post(`/accounts/${account.id}/adjust`, { actual_balance: 100000 });
  listed = (await app.api.get('/bills')).find((b) => b.id === bill.id);
  assert.equal(listed.auto_pay_blocked, false);
  assert.equal(await balanceOf(account.id), 45000);
});

test('tanpa potong otomatis, tagihan jatuh tempo tidak dibayar sendiri', async () => {
  const account = await app.api.post('/accounts', { name: 'Mandiri', type: 'bank', initial_balance: 500000 });
  const bill = await app.api.post('/bills', {
    name: 'Listrik', amount: 200000, frequency: 'monthly', next_due: daysFromToday(-1),
    category_id: await categoryId(app.api, 'Tagihan'), account_id: account.id, auto_pay: false,
  });
  const listed = (await app.api.get('/bills')).find((b) => b.id === bill.id);
  assert.equal(listed.next_due, daysFromToday(-1));
  assert.equal(await balanceOf(account.id), 500000);
});

test('riwayat tagihan berisi pembayaran manual, otomatis, dan periode yang dilewati', async () => {
  const account = await app.api.post('/accounts', { name: 'Jago', type: 'bank', initial_balance: 1000000 });
  const bill = await app.api.post('/bills', {
    name: 'Internet', amount: 300000, frequency: 'monthly', next_due: daysFromToday(0),
    category_id: await categoryId(app.api, 'Tagihan'), account_id: account.id, auto_pay: true,
  });
  await app.api.get('/bills'); // potong otomatis periode ini
  await app.api.post(`/bills/${bill.id}/skip`);
  await app.api.post(`/bills/${bill.id}/pay`, { amount: 350000, account_id: account.id, date: daysFromToday(0) });

  const { events, stats } = await app.api.get(`/bills/${bill.id}/history`);
  assert.deepEqual(events.map((e) => e.type).sort(), ['paid', 'paid', 'skipped']);
  assert.equal(events.filter((e) => e.auto).length, 1);
  assert.equal(stats.count, 2);
  assert.equal(stats.total, 650000);
  assert.equal(stats.average, 325000);
  assert.equal(stats.skipped, 1);
});
