import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let app;
let account;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 10000000 });
});
after(() => app.close());

const findDebt = async (name) => (await app.api.get('/debts')).find((d) => d.counterparty === name);

test('utang bertenor membuat jadwal cicilan & tagihan bulanan', async () => {
  await app.api.post('/debts', {
    direction: 'payable', type: 'paylater', counterparty: 'Kredivo',
    principal: 3000000, total_amount: 3600000, tenor: 12, first_due: '2027-01-31', account_id: account.id,
  });
  const debt = await findDebt('Kredivo');
  assert.equal(debt.installment, 300000);
  assert.equal(debt.installments.length, 12);
  assert.deepEqual(debt.installments.slice(0, 3).map((i) => i.due_date), ['2027-01-31', '2027-02-28', '2027-03-31']);

  const bill = (await app.api.get('/bills')).find((b) => b.debt_id === debt.id);
  assert.equal(bill.next_due, '2027-01-31');
});

test('pencairan pinjaman bukan pemasukan, tapi menambah saldo', async () => {
  const balance = (await app.api.get('/accounts'))[0].balance;
  assert.equal(balance, 13000000);
  const summary = await app.api.get('/summary?month=' + new Date().toISOString().slice(0, 7));
  assert.equal(summary.income, 0);
});

test('pembayaran mengisi cicilan paling awal dulu (termasuk bayar sebagian)', async () => {
  const debt = await findDebt('Kredivo');
  await app.api.post(`/debts/${debt.id}/pay`, { amount: 650000, account_id: account.id, date: '2027-01-20' });
  const after = await findDebt('Kredivo');
  assert.deepEqual(after.installments.slice(0, 3).map((i) => [i.status === 'paid', i.outstanding]), [
    [true, 0], [true, 0], [false, 250000],
  ]);
  assert.equal(after.remaining, 3600000 - 650000);

  // Tagihan ikut maju ke cicilan ke-3 yang belum lunas.
  const bill = (await app.api.get('/bills')).find((b) => b.debt_id === debt.id);
  assert.equal(bill.next_due, '2027-03-31');
});

test('edit total utang menghitung ulang jadwal dengan tenor yang sama', async () => {
  const debt = await findDebt('Kredivo');
  await app.api.put(`/debts/${debt.id}`, {
    counterparty: 'Kredivo', type: 'paylater', principal: 3000000, total_amount: 4200000, note: 'HP baru',
  });
  const edited = await findDebt('Kredivo');
  assert.equal(edited.total_amount, 4200000);
  assert.equal(edited.installment, 350000);
  assert.equal(edited.installments.length, 12);
  assert.equal(edited.installments.reduce((sum, i) => sum + i.amount, 0), 4200000);
  assert.equal(edited.installments[0].due_date, '2027-01-31');
});

test('lunas → tagihan cicilan otomatis nonaktif', async () => {
  const debt = await findDebt('Kredivo');
  await app.api.post(`/debts/${debt.id}/pay`, { amount: debt.remaining, account_id: account.id, date: '2027-02-01' });
  assert.equal((await findDebt('Kredivo')).remaining, 0);
  assert.equal((await app.api.get('/bills')).some((b) => b.debt_id === debt.id), false);
});

test('pembayaran invoice klien tercatat sebagai pemasukan', async () => {
  await app.api.post('/debts', {
    direction: 'receivable', type: 'invoice', counterparty: 'PT Maju', principal: 5000000, due_date: '2026-12-01', account_id: account.id,
  });
  const invoice = await findDebt('PT Maju');
  const balanceBefore = (await app.api.get('/accounts'))[0].balance;
  await app.api.post(`/debts/${invoice.id}/pay`, { amount: 2000000, account_id: account.id, date: '2026-11-15' });

  const summary = await app.api.get('/summary?month=2026-11');
  assert.equal(summary.income, 2000000);
  assert.equal((await findDebt('PT Maju')).remaining, 3000000);
  // Membuat invoice tidak mengurangi saldo; pembayarannya menambah.
  assert.equal((await app.api.get('/accounts'))[0].balance, balanceBefore + 2000000);
  const [income] = await app.api.get('/transactions?month=2026-11&kind=income');
  assert.equal(income.category_name, 'Freelance');
});

test('invoice tidak boleh dibuat sebagai utang', async () => {
  const { status, data } = await app.call('POST', '/debts', { direction: 'payable', type: 'invoice', counterparty: 'X', principal: 1000 });
  assert.equal(status, 400);
  assert.match(data.error, /Invoice/);
});

test('utang tanpa uang masuk: pembayarannya dihitung pengeluaran "Bayar utang"', async () => {
  await app.api.post('/debts', { direction: 'payable', type: 'personal', counterparty: 'Pak Aat', principal: 3800000 });
  const debt = (await app.api.get('/debts')).find((d) => d.counterparty === 'Pak Aat');
  assert.equal(debt.count_as_expense, true);
  await app.api.post(`/debts/${debt.id}/pay`, { amount: 800000, account_id: account.id, date: '2026-12-05' });
  const summary = await app.api.get('/summary?month=2026-12');
  assert.equal(summary.expense, 800000);
  assert.ok(summary.categories.some((c) => c.name === 'Bayar utang' && c.spent === 800000));
  assert.equal((await app.api.get('/debts')).find((d) => d.id === debt.id).remaining, 3000000);
});

test('opsi bisa dimatikan: pembayaran lama dikonversi jadi bukan pengeluaran', async () => {
  const debt = (await app.api.get('/debts')).find((d) => d.counterparty === 'Pak Aat');
  await app.api.put(`/debts/${debt.id}`, { counterparty: 'Pak Aat', type: 'personal', principal: 3800000, count_as_expense: false });
  const summary = await app.api.get('/summary?month=2026-12');
  assert.equal(summary.expense, 0);
  assert.equal((await app.api.get('/debts')).find((d) => d.id === debt.id).remaining, 3000000); // sisa tetap
});

test('utang dengan uang masuk (pinjol cair) bawaannya bukan pengeluaran', async () => {
  const kredivo = (await app.api.get('/debts')).find((d) => d.counterparty === 'Kredivo');
  assert.equal(kredivo.count_as_expense, false);
});

test('riwayat utang: dicatat/diterima, pembayaran dengan sisa, lalu lunas', async () => {
  const account = await app.api.post('/accounts', { name: 'Riwayat Acc', type: 'bank', initial_balance: 2000000 });
  const debt = await app.api.post('/debts', {
    direction: 'payable', type: 'loan', counterparty: 'Indodana', principal: 1000000, total_amount: 1305000,
    tenor: 3, first_due: '2026-09-25', account_id: account.id,
  });
  await app.api.post(`/debts/${debt.id}/pay`, { amount: 435000, account_id: account.id, date: '2026-09-05' });
  let history = await app.api.get(`/debts/${debt.id}/history`);
  assert.deepEqual(history.events.map((e) => e.type), ['payment', 'disbursed']);
  assert.equal(history.events[0].remaining_after, 870000);
  assert.equal(history.debt.remaining, 870000);

  await app.api.post(`/debts/${debt.id}/pay`, { amount: 870000, account_id: account.id, date: '2026-10-28' });
  history = await app.api.get(`/debts/${debt.id}/history`);
  assert.deepEqual(history.events.map((e) => e.type), ['settled', 'payment', 'payment', 'disbursed']);
  assert.equal(history.events[0].date, '2026-10-28');
});
