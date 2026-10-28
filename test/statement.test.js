import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHeader, guessMapping, parseMoney, parseDate, parseStatement, guessCategoryName, noteKey } from '../public/js/statement.js';

test('angka: format Indonesia, internasional, Rp, minus, akhiran DB/CR', () => {
  assert.deepEqual(parseMoney('1.234.567,00'), { value: 1234567, sign: 1 });
  assert.deepEqual(parseMoney('1,234,567.00'), { value: 1234567, sign: 1 });
  assert.deepEqual(parseMoney('Rp 50.000'), { value: 50000, sign: 1 });
  assert.deepEqual(parseMoney('-25.000'), { value: 25000, sign: -1 });
  assert.deepEqual(parseMoney('250,000.00 DB'), { value: 250000, sign: -1 });
  assert.deepEqual(parseMoney('2.500.000,00 CR'), { value: 2500000, sign: 1 });
  assert.deepEqual(parseMoney(-12000), { value: 12000, sign: -1 });
});

test('tanggal: berbagai format', () => {
  assert.equal(parseDate('05/10/2026'), '2026-10-05');
  assert.equal(parseDate('5-10-26'), '2026-10-05');
  assert.equal(parseDate('2026-10-05 13:00'), '2026-10-05');
  assert.equal(parseDate('05/10', 2026), '2026-10-05'); // mutasi BCA tanpa tahun
  assert.equal(parseDate('12 Okt 2026'), '2026-10-12');
  assert.equal(parseDate(46300), '2026-10-05'); // serial Excel
  assert.equal(parseDate('PEND'), null);
});

test('mutasi gaya BCA: kolom jumlah dengan akhiran DB/CR, baris pendahuluan dilewati', () => {
  const rows = [
    ['Informasi Rekening - Mutasi Rekening'], ['No. rekening :', '1234567890'], [],
    ['Tanggal Transaksi', 'Keterangan', 'Cabang', 'Jumlah', 'Saldo'],
    ['01/10', 'TRSF E-BANKING CR 0110/FTSCY/WS95051 GAJI OKTOBER', '0000', '8,000,000.00 CR', '9,000,000.00'],
    ['03/10', 'KARTU DEBIT INDOMARET', '0000', '125,500.00 DB', '8,874,500.00'],
    ['04/10', 'BIAYA ADM', '0000', '10,000.00 DB', '8,864,500.00'],
    ['Saldo Awal', '', '', '1,000,000.00', ''],
  ];
  const header = findHeader(rows);
  assert.equal(header, 3);
  const mapping = guessMapping(rows[header]);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.note, 1);
  assert.equal(mapping.amount, 3);
  const parsed = parseStatement(rows, header, mapping, 2026);
  assert.deepEqual(parsed.map((r) => [r.date, r.amount, r.kind]), [
    ['2026-10-01', 8000000, 'income'], ['2026-10-03', 125500, 'expense'], ['2026-10-04', 10000, 'expense'],
  ]);
});

test('mutasi dengan kolom debit & kredit terpisah', () => {
  const rows = [['Tanggal', 'Deskripsi', 'Debit', 'Kredit', 'Saldo'], ['2026-10-02', 'GOPAY TOPUP', '100.000', '', '900.000'], ['2026-10-03', 'Transfer masuk', '', '250.000', '1.150.000']];
  const parsed = parseStatement(rows, 0, guessMapping(rows[0]), 2026);
  assert.deepEqual(parsed.map((r) => [r.amount, r.kind]), [[100000, 'expense'], [250000, 'income']]);
});

test('tebakan kategori dari kata kunci & kunci keterangan', () => {
  assert.equal(guessCategoryName('KARTU DEBIT INDOMARET'), 'Belanja');
  assert.equal(guessCategoryName('GOPAY GOFOOD'), 'Makan & Minum');
  assert.equal(guessCategoryName('BIAYA ADM'), 'Biaya admin');
  assert.equal(guessCategoryName('lain-lain'), null);
  assert.equal(noteKey('TRSF E-BANKING DB 0310/FTSCY/WS1'), noteKey('TRSF E-BANKING DB 0510/FTSCY/WS9'));
});

import { before, after } from 'node:test';
import { startTestApp, categoryId } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

test('import: tebak kategori (riwayat & kata kunci), tandai duplikat, lalu simpan', async () => {
  const account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  const other = await categoryId(app.api, 'Lainnya');
  const shopping = await categoryId(app.api, 'Belanja');
  const salary = await categoryId(app.api, 'Gaji');
  // Riwayat: "TRSF E-BANKING DB ... ARISAN" pernah dikategorikan Lainnya; Rp125.500 tgl 3 sudah tercatat.
  await app.api.post('/transactions', { kind: 'expense', amount: 200000, account_id: account.id, category_id: other, date: '2026-09-01', note: 'TRSF E-BANKING DB 0109 ARISAN' });
  await app.api.post('/transactions', { kind: 'expense', amount: 125500, account_id: account.id, category_id: shopping, date: '2026-10-03', note: 'Indomaret' });

  const rows = [
    { date: '2026-10-01', note: 'TRSF E-BANKING CR GAJI OKTOBER', amount: 8000000, kind: 'income' },
    { date: '2026-10-03', note: 'KARTU DEBIT INDOMARET', amount: 125500, kind: 'expense' },
    { date: '2026-10-05', note: 'TRSF E-BANKING DB 0510 ARISAN', amount: 200000, kind: 'expense' },
  ];
  const preview = await app.api.post('/import/preview', { account_id: account.id, rows });
  assert.deepEqual(preview.map((r) => [r.category_id, r.guessed_by, r.duplicate]), [
    [salary, 'keyword', false], [shopping, 'keyword', true], [other, 'history', false],
  ]);

  const chosen = preview.filter((r) => !r.duplicate);
  assert.deepEqual(await app.api.post('/import', { account_id: account.id, rows: chosen }), { imported: 2 });
  const balance = (await app.api.get('/accounts')).find((a) => a.id === account.id).balance;
  assert.equal(balance, -200000 - 125500 + 8000000 - 200000);
  assert.equal((await app.call('POST', '/import', { account_id: account.id, rows: [{ date: 'x', amount: 1, kind: 'income' }] })).status, 400);
});
