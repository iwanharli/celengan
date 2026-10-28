import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
let bill;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 5000000 });
  bill = await app.api.post('/bills', {
    name: 'Kos', amount: 1500000, frequency: 'monthly', next_due: '2027-01-31',
    category_id: await categoryId(app.api, 'Rumah'), account_id: account.id,
  });
});
after(() => app.close());

const nextDue = async () => (await app.api.get('/bills')).find((b) => b.id === bill.id).next_due;

test('tagihan tanggal 31: Feb jadi tanggal 28, lalu kembali ke 31', async () => {
  await app.api.post(`/bills/${bill.id}/pay`, { amount: 1500000, account_id: account.id, date: '2027-01-30' });
  assert.equal(await nextDue(), '2027-02-28');
  await app.api.post(`/bills/${bill.id}/skip`);
  assert.equal(await nextDue(), '2027-03-31');
  await app.api.post(`/bills/${bill.id}/skip`);
  assert.equal(await nextDue(), '2027-04-30');
});

test('bayar tagihan tercatat sebagai pengeluaran dengan kategorinya', async () => {
  const [expense] = await app.api.get('/transactions?month=2027-01&kind=expense');
  assert.equal(expense.amount, 1500000);
  assert.equal(expense.category_name, 'Rumah');
  assert.equal(expense.bill_id, bill.id);
});

test('edit tagihan: tanggal baru jadi patokan tiap periode', async () => {
  await app.api.put(`/bills/${bill.id}`, {
    name: 'Kos baru', amount: 1750000, frequency: 'monthly', next_due: '2027-05-10',
    category_id: await categoryId(app.api, 'Rumah'), account_id: account.id,
  });
  const [edited] = await app.api.get('/bills');
  assert.equal(edited.name, 'Kos baru');
  assert.equal(edited.amount, 1750000);
  assert.equal(edited.due_day, 10);
  await app.api.post(`/bills/${bill.id}/skip`);
  assert.equal(await nextDue(), '2027-06-10');
});

test('tagihan tahunan & mingguan', async () => {
  const yearly = await app.api.post('/bills', { name: 'Domain', amount: 150000, frequency: 'yearly', next_due: '2028-02-29' });
  const weekly = await app.api.post('/bills', { name: 'Laundry', amount: 50000, frequency: 'weekly', next_due: '2027-01-29' });
  await app.api.post(`/bills/${yearly.id}/skip`);
  await app.api.post(`/bills/${weekly.id}/skip`);
  const bills = await app.api.get('/bills');
  assert.equal(bills.find((b) => b.id === yearly.id).next_due, '2029-02-28');
  assert.equal(bills.find((b) => b.id === weekly.id).next_due, '2027-02-05');
});
