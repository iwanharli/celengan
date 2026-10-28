import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let transaction;
// JPEG "palsu" kecil: cukup byte awal FF D8 FF + isi + penutup FF D9.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('isi-foto-struk'), Buffer.from([0xff, 0xd9])]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('isi-png')]);

before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  transaction = await app.api.post('/transactions', {
    kind: 'expense', amount: 125000, account_id: account.id, category_id: await categoryId(app.api, 'Belanja'), date: '2026-10-20',
  });
});
after(() => app.close());

const listed = async () => (await app.api.get('/transactions?month=2026-10'))[0];

test('unggah beberapa foto ke satu transaksi', async () => {
  const first = await app.upload(`/transactions/${transaction.id}/attachments`, jpeg, 'image/jpeg', 'struk indomaret.jpg');
  const second = await app.upload(`/transactions/${transaction.id}/attachments`, png, 'image/png', 'nota.png');
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.data.original_name, 'struk indomaret.jpg');
  assert.deepEqual((await listed()).attachments.map((photo) => photo.name), ['struk indomaret.jpg', 'nota.png']);
});

test('foto bisa dibuka lagi dengan jenis & isi yang sama', async () => {
  const [photo] = (await listed()).attachments;
  const file = await app.download(`/attachments/${photo.id}`);
  assert.equal(file.status, 200);
  assert.equal(file.type, 'image/jpeg');
  assert.deepEqual(file.body, jpeg);
});

test('foto hanya bisa diunggah & dibuka setelah login', async () => {
  const [photo] = (await listed()).attachments;
  assert.equal((await app.download(`/attachments/${photo.id}`, { loggedIn: false })).status, 401);
  assert.equal((await app.upload(`/transactions/${transaction.id}/attachments`, jpeg, 'image/jpeg', 'x.jpg', { loggedIn: false })).status, 401);
});

test('file yang bukan gambar ditolak', async () => {
  const fake = await app.upload(`/transactions/${transaction.id}/attachments`, Buffer.from('<script>alert(1)</script>'), 'image/jpeg');
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /bukan gambar/);
  const pdf = await app.upload(`/transactions/${transaction.id}/attachments`, Buffer.from('%PDF-1.4'), 'application/pdf');
  assert.equal(pdf.status, 400);
});

test('maksimal 10 foto per transaksi', async () => {
  for (let i = 0; i < 8; i += 1) await app.upload(`/transactions/${transaction.id}/attachments`, jpeg, 'image/jpeg');
  const eleventh = await app.upload(`/transactions/${transaction.id}/attachments`, jpeg, 'image/jpeg');
  assert.equal(eleventh.status, 400);
  assert.match(eleventh.data.error, /Maksimal 10/);
});

test('hapus satu foto', async () => {
  const [photo] = (await listed()).attachments;
  await app.api.delete(`/attachments/${photo.id}`);
  assert.equal((await listed()).attachments.length, 9);
  assert.equal((await app.download(`/attachments/${photo.id}`)).status, 404);
});

test('hapus transaksi → data fotonya ikut terhapus', async () => {
  await app.api.delete(`/transactions/${transaction.id}`);
  const backup = await app.exportData();
  assert.equal(backup.data.transaction_attachments.length, 0);
});
