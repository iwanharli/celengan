import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => {
  app = await startTestApp();
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const salary = await categoryId(app.api, 'Gaji');
  const food = await categoryId(app.api, 'Makan & Minum');
  // 3 bulan riwayat: pemasukan 12jt, 2,5jt, 6jt; pengeluaran 3,5jt, 3,2jt, 3jt
  const months = [['2026-09', 12000000, 3500000], ['2026-08', 2500000, 3200000], ['2026-07', 6000000, 3000000]];
  for (const [month, income, expense] of months) {
    await app.api.post('/transactions', { kind: 'income', amount: income, account_id: account.id, category_id: salary, date: `${month}-10` });
    await app.api.post('/transactions', { kind: 'expense', amount: expense, account_id: account.id, category_id: food, date: `${month}-12` });
  }
  await app.api.post('/bills', { name: 'Internet', amount: 400000, frequency: 'monthly', next_due: '2026-11-05' });
});
after(() => app.close());

test('perkiraan tabungan = rata-rata pemasukan − pengeluaran − tagihan', async () => {
  const { savings } = await app.api.get('/summary?month=2026-10');
  assert.equal(savings.income, Math.round((12000000 + 2500000 + 6000000) / 3));
  assert.equal(savings.dailyExpense, Math.round((3500000 + 3200000 + 3000000) / 3));
  assert.equal(savings.recurringBills, 400000);
  assert.equal(savings.estimate, savings.income - savings.dailyExpense - 400000);
  assert.equal(savings.isRough, false);
  assert.equal(savings.actualLastMonth, 12000000 - 3500000);
  assert.equal(savings.lowScenario, null); // hanya untuk freelance
});

test('mode freelance: rata-rata 6 bulan, skenario bulan sepi & dana cukup berapa lama', async () => {
  await app.api.put('/settings', { month_start_day: 25, income_mode: 'freelance' });
  const settings = await app.api.get('/settings');
  assert.equal(settings.month_start_day, 1); // freelance memakai bulan kalender

  const summary = await app.api.get('/summary?month=2026-10');
  const { savings } = summary;
  assert.equal(savings.historyMonths, 6);
  assert.equal(savings.isRough, true); // baru 3 dari 6 bulan
  assert.equal(savings.lowScenario.income, 2500000);
  assert.equal(savings.lowScenario.estimate, 2500000 - savings.monthlyNeed);
  assert.ok(Math.abs(summary.runwayMonths - summary.totalBalance / savings.monthlyNeed) < 1e-9);
});
