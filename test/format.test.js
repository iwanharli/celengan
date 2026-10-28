import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, addMonths, rupiah } from '../public/js/format.js';

test('parseAmount memahami cara orang Indonesia mengetik nominal', () => {
  assert.equal(parseAmount('25rb'), 25000);
  assert.equal(parseAmount('25 ribu'), 25000);
  assert.equal(parseAmount('2k'), 2000);
  assert.equal(parseAmount('1,5jt'), 1500000);
  assert.equal(parseAmount('2 juta'), 2000000);
  assert.equal(parseAmount('Rp 50.000'), 50000);
  assert.equal(parseAmount('1.250.000'), 1250000);
  assert.equal(parseAmount('15000000'), 15000000);
});

test('parseAmount mengembalikan 0 untuk teks yang bukan nominal', () => {
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseAmount(null), 0);
});

test('addMonths tidak meluber di akhir bulan', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29'); // kabisat
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('rupiah memformat tanpa desimal', () => {
  assert.match(rupiah(1250000), /^Rp\s?1\.250\.000$/);
});

test('formatAmountInput memberi titik ribuan, singkatan dibiarkan', async () => {
  const { formatAmountInput } = await import('../public/js/format.js');
  assert.equal(formatAmountInput(1500000), '1.500.000');
  assert.equal(formatAmountInput('25000'), '25.000');
  assert.equal(formatAmountInput('1.2345'), '12.345'); // titik lama dirapikan ulang
  assert.equal(formatAmountInput('-500000'), '-500.000');
  assert.equal(formatAmountInput('007'), '7');
  assert.equal(formatAmountInput('999'), '999');
  assert.equal(formatAmountInput('25rb'), '25rb');
  assert.equal(formatAmountInput('1,5jt'), '1,5jt');
  assert.equal(formatAmountInput(''), '');
  // Hasilnya tetap terbaca benar oleh parseAmount
  assert.equal(parseAmount(formatAmountInput(1250000)), 1250000);
  assert.equal(parseAmount('1.500rb'), 1500000);
});
