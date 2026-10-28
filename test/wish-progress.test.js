import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wishTargetStatus } from '../public/js/wish-progress.js';

// Dimasukkan 1 Jan, target 1 Jul (181 hari), harga 6 juta.
const item = (saved, extra = {}) => ({
  price: 6000000, saved, created_at: '2026-01-01T03:00:00.000Z', target_date: '2026-07-01', ...extra,
});

test('tanpa target atau dana sudah cukup → tidak ada status', () => {
  assert.equal(wishTargetStatus(item(0, { target_date: null }), '2026-03-01'), null);
  assert.equal(wishTargetStatus(item(6000000), '2026-03-01'), null);
});

test('seharusnya terkumpul dihitung merata sampai tanggal target', () => {
  const status = wishTargetStatus(item(2000000), '2026-04-01'); // 90 dari 181 hari ≈ 49,7%
  assert.equal(status.percentExpected, 50);
  assert.equal(status.expected, Math.round(6000000 * 90 / 181));
});

test('tertinggal, sesuai jalur, dan lebih cepat', () => {
  assert.equal(wishTargetStatus(item(1000000), '2026-04-01').level, 'behind');
  assert.equal(wishTargetStatus(item(2950000), '2026-04-01').level, 'on_track');
  assert.equal(wishTargetStatus(item(4000000), '2026-04-01').level, 'ahead');
});

test('saran per bulan untuk mengejar target', () => {
  const status = wishTargetStatus(item(1000000), '2026-04-01'); // 91 hari lagi → 4 bulan
  assert.equal(status.perMonth, Math.ceil(5000000 / 4));
});

test('lewat target', () => {
  const status = wishTargetStatus(item(5000000), '2026-07-11');
  assert.equal(status.level, 'late');
  assert.equal(status.daysLate, 10);
  assert.equal(status.remaining, 1000000);
});
