import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAlerts, periodProgress } from '../public/js/budget-alerts.js';

const october = { start: '2026-10-01', end: '2026-11-01' };
const category = (name, spent, budget) => ({ id: name, name, spent, monthly_budget: budget });

test('progres periode dihitung dari hari ini', () => {
  assert.equal(Math.round(periodProgress(october, '2026-10-15') * 100), 48);
  assert.equal(periodProgress(october, '2026-10-31'), 1);
});

test('lewat anggaran, hampir habis, dan belanja terlalu cepat', () => {
  const alerts = budgetAlerts([
    category('Makan', 2100000, 2000000),   // over
    category('Belanja', 850000, 1000000),  // almost (85%)
    category('Hiburan', 300000, 400000),   // 75% di hari ke-10 (32%) → fast
    category('Transport', 100000, 600000), // aman
    category('Rumah', 0, 500000),          // belum dipakai
    category('Lainnya', 900000, null),     // tanpa anggaran
  ], october, '2026-10-10');

  assert.deepEqual(alerts.map((alert) => [alert.name, alert.level]), [
    ['Makan', 'over'], ['Belanja', 'almost'], ['Hiburan', 'fast'],
  ]);
  const hiburan = alerts[2];
  assert.equal(hiburan.percentTime, 32);
  assert.equal(hiburan.projected, 930000);
  assert.equal(hiburan.projectedOver, 530000);
  assert.equal(hiburan.dailyAllowance, Math.floor(100000 / 21));
  assert.equal(alerts[0].overBy, 100000);
});

test('belanja yang sejalan dengan waktu tidak diperingatkan', () => {
  assert.deepEqual(budgetAlerts([category('Makan', 1000000, 2000000)], october, '2026-10-16'), []);
});
