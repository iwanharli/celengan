import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('kunci VAPID dibuat sekali; langganan tidak valid ditolak', async () => {
  const first = await app.api.get('/notifications');
  assert.ok(first.publicKey.length > 40);
  assert.equal((await app.api.get('/notifications')).publicKey, first.publicKey);
  assert.equal((await app.call('POST', '/notifications/subscribe', { subscription: { endpoint: 'x' } })).status, 400);
  assert.equal((await app.call('POST', '/notifications/test')).status, 400); // belum ada browser
});

test('pengingat H-1 & hari-H, sekali per jatuh tempo', async () => {
  // Diimpor di sini (bukan di atas) supaya terhubung ke database test.
  const { dueReminders, reminderMessage } = await import('../server/notify.js');
  const { query } = await import('../server/db.js');
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const category = await categoryId(app.api, 'Hiburan');
  const bill = (body) => app.api.post('/bills', { frequency: 'monthly', category_id: category, account_id: account.id, ...body });
  await bill({ name: 'Netflix', amount: 65000, next_due: '2026-11-02' });
  await bill({ name: 'Listrik', amount: 300000, next_due: '2026-11-01' });
  await bill({ name: 'Kos', amount: 1500000, next_due: '2026-11-10' });

  const due = await dueReminders('2026-11-01');
  assert.deepEqual(due.map((b) => [b.name, b.kind]), [['Listrik', 'today'], ['Netflix', 'tomorrow']]);
  const netflix = reminderMessage(due.find((b) => b.name === 'Netflix'));
  assert.equal(netflix.title, 'Besok jatuh tempo: Netflix');
  assert.match(netflix.body, /Rp 65\.000 · ⚠️ Saldo BCA kurang Rp 65\.000, isi dulu ya\./);

  // Sudah diingatkan → tidak muncul lagi untuk jatuh tempo yang sama.
  for (const b of due) await query('INSERT INTO bill_reminders (bill_id, due_date, kind) VALUES ($1, $2, $3)', [b.id, b.next_due, b.kind]);
  assert.equal((await dueReminders('2026-11-01')).length, 0);
  // Besoknya Netflix diingatkan lagi sebagai "hari ini".
  assert.deepEqual((await dueReminders('2026-11-02')).map((b) => [b.name, b.kind]), [['Netflix', 'today']]);
});
