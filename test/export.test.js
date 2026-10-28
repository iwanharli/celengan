import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startTestApp, categoryId } from './helpers.js';

let app;
let bca;
let cash;
before(async () => {
  app = await startTestApp();
  bca = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 1000000, account_number: '1234567890' });
  cash = await app.api.post('/accounts', { name: 'Dompet', type: 'cash', initial_balance: 0 });
  const food = await categoryId(app.api, 'Makan & Minum');
  const salary = await categoryId(app.api, 'Gaji');
  await app.api.post('/transactions', { kind: 'income', amount: 8000000, account_id: bca.id, category_id: salary, date: '2026-09-25', note: 'Gaji' });
  await app.api.post('/transactions', { kind: 'expense', amount: 25000, account_id: cash.id, category_id: food, date: '2026-10-02', note: 'Bakso; pedas' });
  await app.api.post('/transactions', { kind: 'expense', amount: 1250000, account_id: bca.id, category_id: food, date: '2026-10-15' });
  await app.api.post('/bills', { name: 'Internet', amount: 350000, frequency: 'monthly', next_due: '2026-11-05' });
  await app.api.post('/wishlist', { name: 'Pernikahan', price: 50000000, kind: 'wedding', parts: [{ name: 'Gedung', amount: 15000000 }] });
});
after(() => app.close());

const base = { datasets: ['transactions'], period: 'all', format: 'csv', dataset: 'transactions', date_format: 'iso', money_format: 'number', separator: ';' };
const csvRows = (file) => file.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');

test('pratinjau: jumlah baris & contoh per data', async () => {
  const preview = await app.api.post('/export/preview', { ...base, datasets: ['transactions', 'accounts', 'bills', 'wishlist_parts'] });
  assert.deepEqual(preview.map((item) => [item.key, item.count]), [['transactions', 3], ['accounts', 3], ['bills', 1], ['wishlist_parts', 1]]);
  assert.equal(preview[0].sample[0][0], '2026-09-25');
});

test('filter periode, jenis & akun', async () => {
  const october = await app.api.post('/export/preview', { ...base, period: 'custom', start: '2026-10-01', end: '2026-10-31' });
  assert.equal(october[0].count, 2);
  const current = await app.api.post('/export/preview', { ...base, period: 'current', current: { month: '2026-09' } });
  assert.equal(current[0].count, 1);
  const expenseCash = await app.api.post('/export/preview', { ...base, kinds: ['expense'], account_ids: [cash.id] });
  assert.equal(expenseCash[0].count, 1);
});

test('CSV: format tanggal, nominal & pemisah sesuai pengaturan', async () => {
  const file = await app.download('/export/file', { body: { ...base, date_format: 'dmy', money_format: 'rupiah', separator: ',' } });
  assert.equal(file.status, 200);
  assert.match(file.fileName, /^celengan-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, first, second] = csvRows(file);
  assert.equal(header.split(',')[0], 'Tanggal');
  assert.ok(first.startsWith('25/09/2026,Pemasukan,Rp 8.000.000,BCA'), first);
  assert.match(second, /"Bakso; pedas"|Bakso; pedas/); // pemisah koma → titik koma di catatan aman
});

test('Excel: satu sheet per data, tanggal & nominal sebagai angka', async () => {
  const file = await app.download('/export/file', { body: { ...base, format: 'xlsx', datasets: ['transactions', 'accounts', 'wishlist'] } });
  assert.equal(file.status, 200);
  assert.match(file.type, /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.body);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['Transaksi', 'Akun', 'Wishlist']);
  const transactions = workbook.getWorksheet('Transaksi');
  assert.equal(transactions.rowCount, 4);
  assert.equal(transactions.getCell('C2').value, 8000000);
  assert.ok(transactions.getCell('A2').value instanceof Date);
  assert.equal(workbook.getWorksheet('Akun').getCell('D2').value, '1234567890');
});

test('PDF: laporan terbentuk dengan semua data', async () => {
  const file = await app.download('/export/file', {
    body: { ...base, format: 'pdf', datasets: ['transactions', 'accounts', 'bills', 'wishlist', 'wishlist_parts', 'categories'], period_label: 'Semua waktu' },
  });
  assert.equal(file.status, 200);
  assert.equal(file.type, 'application/pdf');
  assert.match(file.fileName, /^celengan-laporan-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(file.body.subarray(0, 5).toString(), '%PDF-');
  assert.ok(file.body.length > 5000);
});

test('tanpa data dipilih ditolak; jalur export lama sudah tidak ada', async () => {
  assert.equal((await app.call('POST', '/export/preview', { ...base, datasets: [] })).status, 400);
  assert.equal((await app.download('/export/transactions.csv')).status, 404);
});
