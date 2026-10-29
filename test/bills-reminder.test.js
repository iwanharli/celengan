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

test('tagihan hanya pengingat: jatuh tempo tidak dibayar sendiri', async () => {
  const account = await app.api.post('/accounts', { name: 'Mandiri', type: 'bank', initial_balance: 500000 });
  const bill = await app.api.post('/bills', {
    name: 'Listrik', amount: 200000, frequency: 'monthly', next_due: daysFromToday(-1),
    category_id: await categoryId(app.api, 'Tagihan'), account_id: account.id,
  });
  const listed = (await app.api.get('/bills')).find((b) => b.id === bill.id);
  assert.equal(listed.next_due, daysFromToday(-1));
  assert.equal(await balanceOf(account.id), 500000);
});

test('riwayat tagihan berisi pembayaran dan periode yang dilewati', async () => {
  const account = await app.api.post('/accounts', { name: 'Jago', type: 'bank', initial_balance: 1000000 });
  const bill = await app.api.post('/bills', {
    name: 'Internet', amount: 300000, frequency: 'monthly', next_due: daysFromToday(0),
    category_id: await categoryId(app.api, 'Tagihan'), account_id: account.id,
  });
  await app.api.post(`/bills/${bill.id}/pay`, { amount: 300000, account_id: account.id, date: daysFromToday(0) });
  await app.api.post(`/bills/${bill.id}/skip`);
  await app.api.post(`/bills/${bill.id}/pay`, { amount: 350000, account_id: account.id, date: daysFromToday(0) });

  const { events, stats } = await app.api.get(`/bills/${bill.id}/history`);
  assert.deepEqual(events.map((e) => e.type).sort(), ['paid', 'paid', 'skipped']);
  assert.equal(stats.count, 2);
  assert.equal(stats.total, 650000);
  assert.equal(stats.average, 325000);
  assert.equal(stats.skipped, 1);
});

test('berhenti langganan: pindah ke daftar berhenti, riwayat tetap ada, bisa diaktifkan lagi', async () => {
  const account = await app.api.post('/accounts', { name: 'Blu', type: 'bank', initial_balance: 500000 });
  const bill = await app.api.post('/bills', {
    name: 'Disney+', amount: 39000, frequency: 'monthly', next_due: daysFromToday(-40),
    category_id: await categoryId(app.api, 'Hiburan'), account_id: account.id,
  });
  await app.api.post(`/bills/${bill.id}/pay`, { amount: 39000, account_id: account.id, date: daysFromToday(-40) });
  await app.api.post(`/bills/${bill.id}/stop`);

  assert.equal((await app.api.get('/bills')).some((b) => b.id === bill.id), false);
  const [ended] = (await app.api.get('/bills/ended')).filter((b) => b.id === bill.id);
  assert.equal(ended.ended_at, daysFromToday(0));
  assert.equal(ended.total_paid, 39000);
  assert.equal((await app.api.get(`/bills/${bill.id}/history`)).stats.count, 1);

  // Aktif lagi: jatuh tempo tidak di masa lalu (periode selama berhenti tidak ditagih).
  const resumed = await app.api.post(`/bills/${bill.id}/resume`);
  assert.ok(resumed.next_due >= daysFromToday(0));
  assert.equal(resumed.ended_at, null);
  assert.ok((await app.api.get('/bills')).some((b) => b.id === bill.id));

  // Hapus permanen: tagihan hilang, transaksi pembayarannya tetap ada.
  await app.api.delete(`/bills/${bill.id}`);
  assert.equal((await app.api.get('/bills/ended')).some((b) => b.id === bill.id), false);
  assert.equal(await balanceOf(account.id), 461000);
});
