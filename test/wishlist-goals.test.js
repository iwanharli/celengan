import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
let other;
let wedding;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 60000000 });
  other = await categoryId(app.api, 'Lainnya');
  wedding = await app.api.post('/wishlist', {
    name: 'Pernikahan', price: 50000000, kind: 'wedding', emoji: '1f492', target_date: '2027-06-01',
    parts: [
      { name: 'Gedung', amount: 15000000 },
      { name: 'Katering', amount: 20000000, note: '300 porsi' },
      { name: 'Busana & rias', amount: 5000000 },
      { name: '  ', amount: 999 }, // baris kosong diabaikan
    ],
  });
});
after(() => app.close());

const getGoal = async () => (await app.api.get('/wishlist')).find((item) => item.id === wedding.id);

test('impian non-barang dengan rincian biaya', async () => {
  const goal = await getGoal();
  assert.equal(goal.kind, 'wedding');
  assert.deepEqual(goal.parts.map((part) => [part.name, part.amount, part.paid]), [
    ['Gedung', 15000000, 0], ['Katering', 20000000, 0], ['Busana & rias', 5000000, 0],
  ]);
  assert.equal(goal.parts[1].note, '300 porsi');
  assert.equal(goal.paid_total, 0);
});

test('bayar rincian (DP) dari dana disisihkan → tercatat pengeluaran, progres tetap', async () => {
  await app.api.post(`/wishlist/${wedding.id}/save`, { amount: 10000000 });
  const goal = await getGoal();
  const katering = goal.parts.find((part) => part.name === 'Katering');
  await app.api.post(`/wishlist/${wedding.id}/parts/${katering.id}/pay`, {
    amount: 5000000, account_id: account.id, category_id: other, date: '2026-10-20', use_saved: true,
  });
  const after = await getGoal();
  assert.equal(after.parts.find((part) => part.name === 'Katering').paid, 5000000);
  assert.equal(after.paid_total, 5000000);
  assert.equal(after.saved, 5000000);                    // diambil dari amplop
  assert.equal(after.saved + after.paid_total, 10000000); // total terkumpul tidak berubah
  const [expense] = await app.api.get('/transactions?month=2026-10&kind=expense');
  assert.equal(expense.note, 'Pernikahan: Katering');
  assert.equal(after.events[0].type, 'part_paid');
});

test('edit rincian: ubah, tambah, hapus — tapi rincian yang sudah dibayar tidak bisa dihapus', async () => {
  const goal = await getGoal();
  const [gedung, katering] = goal.parts;
  const body = { ...goal, parts: [{ ...gedung, amount: 17000000 }, katering, { name: 'Dokumentasi', amount: 4000000 }] };
  await app.api.put(`/wishlist/${wedding.id}`, body);
  const edited = await getGoal();
  assert.deepEqual(edited.parts.map((part) => [part.name, part.amount]), [
    ['Gedung', 17000000], ['Katering', 20000000], ['Dokumentasi', 4000000],
  ]);

  const { status, data } = await app.call('PUT', `/wishlist/${wedding.id}`, { ...goal, parts: [gedung] });
  assert.equal(status, 400);
  assert.match(data.error, /Katering/);
});

test('edit tanpa field parts tidak mengubah rincian', async () => {
  const goal = await getGoal();
  const { parts, ...withoutParts } = goal;
  await app.api.put(`/wishlist/${wedding.id}`, { ...withoutParts, name: 'Pernikahan Iwan' });
  assert.equal((await getGoal()).parts.length, 3);
});

test('tandai tercapai tanpa transaksi pembelian, bisa dibatalkan', async () => {
  await app.api.post(`/wishlist/${wedding.id}/complete`, { date: '2027-06-01' });
  const done = await getGoal();
  assert.equal(done.status, 'bought');
  assert.equal(done.bought_at, '2027-06-01');
  assert.equal(done.transaction_id, null);
  await app.api.post(`/wishlist/${wedding.id}/unbuy`, {});
  assert.equal((await getGoal()).status, 'wanted');
});

test('backup & restore menyimpan rincian dan pembayarannya', async () => {
  const backup = await app.exportData();
  assert.equal(backup.data.wishlist_parts.length, 3);
  await app.restoreData(backup);
  const restored = await getGoal();
  assert.equal(restored.paid_total, 5000000);
  assert.equal(restored.parts.length, 3);
});
