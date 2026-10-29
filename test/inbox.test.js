import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

const today = () => new Date().toLocaleDateString('sv-SE');

test('kotak notifikasi: tagihan hari ini & saldo kurang; tidak dobel; bisa dibaca & dihapus', async () => {
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 50000 });
  await app.api.post('/bills', {
    name: 'Internet', amount: 300000, frequency: 'monthly', next_due: today(),
    category_id: await categoryId(app.api, 'Tagihan'), account_id: account.id,
  });

  let { items, unread } = await app.api.get('/notifications/inbox?collect=1');
  const titles = items.map((item) => item.title);
  assert.ok(titles.includes('Tagihan Internet jatuh tempo hari ini'));
  assert.ok(titles.includes('Saldo BCA kurang untuk Internet'));
  assert.equal(unread, items.length);

  // Diperiksa lagi: kondisi yang sama tidak dicatat dua kali.
  assert.equal((await app.api.get('/notifications/inbox?collect=1')).items.length, items.length);

  await app.api.post(`/notifications/inbox/${items[0].id}/read`);
  assert.equal((await app.api.get('/notifications/inbox')).unread, unread - 1);

  await app.api.delete(`/notifications/inbox/${items[1].id}`);
  ({ items, unread } = await app.api.get('/notifications/inbox?collect=1'));
  assert.equal(items.length, titles.length - 1); // yang dihapus tidak muncul lagi

  await app.api.post('/notifications/inbox/read-all');
  assert.equal((await app.api.get('/notifications/inbox')).unread, 0);
  await app.api.delete('/notifications/inbox/read');
  assert.equal((await app.api.get('/notifications/inbox')).items.length, 0);
});
