import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('wawasan: kenaikan kategori, rasio menabung, biaya admin, dan tagihan yang saldonya kurang', async () => {
  const bca = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 100000 });
  const gopay = await app.api.post('/accounts', { name: 'GoPay', type: 'ewallet', initial_balance: 0 });
  const food = await categoryId(app.api, 'Makan & Minum');
  const salary = await categoryId(app.api, 'Gaji');
  const add = (body) => app.api.post('/transactions', { account_id: bca.id, ...body });

  // September (selesai) vs Oktober (selesai): Makan naik dari 200rb ke 600rb.
  await add({ kind: 'expense', amount: 200000, category_id: food, date: '2026-09-10' });
  await add({ kind: 'income', amount: 5000000, category_id: salary, date: '2026-10-01' });
  await add({ kind: 'expense', amount: 600000, category_id: food, date: '2026-10-10' });
  await add({ kind: 'transfer', amount: 100000, to_account_id: gopay.id, date: '2026-10-11', fee: 2500 });

  const { insights } = await app.api.get('/summary?start=2026-10-01&end=2026-10-31');
  const texts = insights.map((i) => i.text).join('\n');
  assert.match(texts, /Makan & Minum naik 200%/);
  assert.match(texts, /menyisihkan 88% dari pemasukan/);
  assert.match(texts, /Biaya admin transfer periode ini Rp 2\.500 dari 1 transaksi/);

  // Tagihan minggu ini dari akun yang saldonya kurang → paling atas, nada bahaya.
  const today = new Date().toLocaleDateString('sv-SE');
  await app.api.post('/bills', { name: 'Kos', amount: 9000000, frequency: 'monthly', next_due: today, category_id: food, account_id: gopay.id });
  const [first] = (await app.api.get('/summary?start=2026-10-01&end=2026-10-31')).insights;
  assert.equal(first.tone, 'danger');
  assert.match(first.text, /saldo GoPay \(kurang Rp/);
});

test('tenggat pajak: SPT & NPPN sebelum 31 Maret, setor PPh Final tanggal 15', async () => {
  const { taxDeadlines } = await import('../server/insights.js');
  assert.deepEqual(taxDeadlines('2026-02-10', null), []);
  const nppn = taxDeadlines('2026-03-25', { method: 'nppn', taxableIncome: 0 });
  assert.equal(nppn.length, 2);
  assert.match(nppn[0].text, /SPT Tahunan 2025 paling lambat 31 Maret \(6 hari lagi\)/);
  assert.equal(nppn[0].tone, 'danger');
  assert.equal(taxDeadlines('2026-07-20', { method: 'nppn', taxableIncome: 0 }).length, 0);
  const final = taxDeadlines('2026-08-12', { method: 'final', taxableIncome: 600000000 });
  assert.match(final[0].text, /tanggal 15 \(3 hari lagi\)/);
  assert.equal(taxDeadlines('2026-08-12', { method: 'final', taxableIncome: 400000000 }).length, 0);
});

test('target dana darurat: kekurangan & bisa diatur', async () => {
  await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance', emergency_months: 12 });
  const { emergency, savings, runwayMonths } = await app.api.get('/summary?month=2026-10');
  assert.equal(emergency.targetMonths, 12);
  assert.equal(emergency.target, 12 * savings.monthlyNeed);
  assert.ok(emergency.gap >= 0);
  if (runwayMonths < 12) assert.ok(emergency.gap > 0);
  assert.equal((await app.call('PUT', '/settings', { month_start_day: 1, income_mode: 'freelance', emergency_months: 30 })).status, 400);
});
