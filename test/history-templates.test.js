import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let bank;
let food;
before(async () => {
  app = await startTestApp();
  bank = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 10000000 });
  food = await categoryId(app.api, 'Makan & Minum');
});
after(() => app.close());

const balance = async () => (await app.api.get('/accounts')).find((a) => a.id === bank.id).balance;

test('edit pembayaran utang: sisa utang & tagihan ikut menyesuaikan', async () => {
  await app.api.post('/debts', {
    direction: 'payable', type: 'paylater', counterparty: 'Kredivo', principal: 1200000, tenor: 4, first_due: '2026-11-01',
  });
  const [debt] = await app.api.get('/debts');
  await app.api.post(`/debts/${debt.id}/pay`, { amount: 300000, account_id: bank.id, date: '2026-10-25' });
  const [payment] = (await app.api.get('/transactions?month=2026-10')).filter((t) => t.debt_id === debt.id);

  await app.api.put(`/transactions/${payment.id}`, { amount: 600000, account_id: bank.id, date: '2026-10-26', note: 'Bayar 2 cicilan' });
  const after = (await app.api.get('/debts'))[0];
  assert.equal(after.remaining, 600000);
  assert.equal((await app.api.get('/bills')).find((b) => b.debt_id === debt.id).next_due, '2027-01-01');
  const [edited] = (await app.api.get('/transactions?month=2026-10')).filter((t) => t.id === payment.id);
  assert.equal(edited.kind, 'expense'); // jenis tetap (utang tanpa uang masuk → dihitung pengeluaran)
  assert.equal(edited.date, '2026-10-26');
});

test('edit pembelian aset: nilai aset bergeser sebesar selisihnya', async () => {
  const asset = await app.api.post('/assets', { name: 'Emas', type: 'gold', initial_cost: 0, current_value: 0 });
  await app.api.post(`/assets/${asset.id}/buy`, { amount: 1000000, account_id: bank.id, date: '2026-10-20' });
  const [buy] = (await app.api.get('/transactions?month=2026-10')).filter((t) => t.asset_id === asset.id);
  await app.api.put(`/transactions/${buy.id}`, { amount: 1500000, account_id: bank.id, date: '2026-10-20' });
  const [status] = (await app.api.get('/assets')).assets.filter((a) => a.id === asset.id);
  assert.equal(status.current_value, 1500000);
  assert.equal(status.invested, 1500000);
});

test('riwayat: dibuat, diubah (nilai lama → baru), dihapus', async () => {
  const transaction = await app.api.post('/transactions', { kind: 'expense', amount: 25000, account_id: bank.id, category_id: food, date: '2026-10-02', note: 'Bakso' });
  await app.api.put(`/transactions/${transaction.id}`, { ...transaction, amount: 30000, note: 'Bakso + es teh' });
  await app.api.delete(`/transactions/${transaction.id}`);

  const history = await app.api.get(`/transactions/${transaction.id}/history`);
  assert.deepEqual(history.map((h) => h.action), ['deleted', 'updated', 'created']);
  assert.deepEqual(history[1].changes.amount, [25000, 30000]);
  assert.deepEqual(history[1].changes.note, ['Bakso', 'Bakso + es teh']);
  assert.equal(history[1].changes.date, undefined); // hanya kolom yang berubah

  const [deleted] = await app.api.get('/transactions/history/deleted');
  assert.equal(deleted.transaction_id, transaction.id);
  assert.equal(deleted.snapshot.amount, 30000);
  assert.equal(deleted.category_name, 'Makan & Minum');
});

test('restore backup tidak menambah riwayat baru', async () => {
  const before = (await app.exportData()).data.transaction_history.length;
  await app.restoreData(await app.exportData());
  assert.equal((await app.exportData()).data.transaction_history.length, before);
});

test('favorit: disimpan & tampil di daftar (dipakai untuk mengisi form transaksi)', async () => {
  const template = await app.api.post('/templates', { name: 'Kopi', kind: 'expense', amount: 18000, account_id: bank.id, category_id: food });
  const [listed] = await app.api.get('/templates');
  assert.equal(listed.id, template.id);
  assert.equal(listed.amount, 18000);
  assert.equal(listed.category_id, food);
});

test('favorit tanpa kategori ditolak', async () => {
  const { status } = await app.call('POST', '/templates', { name: 'X', kind: 'expense', amount: 1000, account_id: bank.id });
  assert.equal(status, 400);
});
