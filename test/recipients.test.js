import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('kirim ke penerima tercatat sebagai pengeluaran + biaya admin, lengkap dengan riwayat', async () => {
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 2000000 });
  const category = await categoryId(app.api, 'Lainnya');
  const ibu = await app.api.post('/recipients', {
    name: 'Ibu', relation: 'parent', method: 'bank', provider: 'BRI',
    account_number: '1234 5678 90', holder_name: 'Siti', category_id: category,
  });
  assert.equal(ibu.account_number, '1234567890');

  await app.api.post('/transactions', {
    kind: 'expense', amount: 500000, account_id: account.id, category_id: category,
    date: new Date().toLocaleDateString('sv-SE'), recipient_id: ibu.id, fee: 2500,
  });
  const balance = (await app.api.get('/accounts')).find((a) => a.id === account.id).balance;
  assert.equal(balance, 2000000 - 500000 - 2500);

  const [listed] = await app.api.get('/recipients');
  assert.equal(listed.total_sent, 500000);
  assert.equal(listed.month_sent, 500000);
  assert.equal(listed.sent_count, 1);
  assert.equal(listed.last_fee, 2500);
  assert.equal(listed.last_account_id, account.id);

  const history = await app.api.get(`/recipients/${ibu.id}/history`);
  assert.equal(history.length, 1);
  assert.equal(history[0].fee, 2500);
});

test('favorit tampil paling atas; hapus penerima tidak menghapus kirimannya', async () => {
  const teman = await app.api.post('/recipients', { name: 'Andi', relation: 'friend', method: 'ewallet', provider: 'DANA' });
  await app.api.put(`/recipients/${teman.id}/favorite`);
  const list = await app.api.get('/recipients');
  assert.equal(list[0].name, 'Andi');
  assert.equal(list[0].is_favorite, true);

  const ibu = list.find((r) => r.name === 'Ibu');
  await app.api.delete(`/recipients/${ibu.id}`);
  const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const sent = (await app.api.get(`/transactions?month=${month}`)).find((t) => t.amount === 500000);
  assert.ok(sent);
  assert.equal(sent.recipient_id, null);
});
