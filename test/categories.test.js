import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, categoryId } from './helpers.js';

let app;
let account;
let coffee;
let food;
before(async () => {
  app = await startTestApp();
  account = await app.api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 0 });
  food = await categoryId(app.api, 'Makan & Minum');
  coffee = await app.api.post('/categories', { name: 'Kopi', kind: 'expense', icon: 'coffee', color: '#a16207' });
  await app.api.put(`/categories/${coffee.id}/budget`, { monthly_budget: 300000 });
  await app.api.put(`/categories/${food}/budget`, { monthly_budget: 2000000 });
  const today = new Date().toLocaleDateString('sv-SE');
  for (const amount of [18000, 22000, 25000]) {
    await app.api.post('/transactions', { kind: 'expense', amount, account_id: account.id, category_id: coffee.id, date: today });
  }
  await app.api.post('/bills', { name: 'Langganan kopi', amount: 100000, frequency: 'monthly', next_due: today, category_id: coffee.id });
});
after(() => app.close());

const find = async (id) => (await app.api.get('/categories')).find((category) => category.id === id);

test('statistik pemakaian & urutan dari yang paling sering dipakai', async () => {
  const categories = await app.api.get('/categories');
  const expense = categories.filter((category) => category.kind === 'expense');
  assert.equal(expense[0].name, 'Kopi');
  assert.equal(expense[0].usage_count, 3);
  assert.equal(expense[0].usage_total, 65000);
  assert.equal(expense[0].bill_count, 1);
});

test('arsipkan & aktifkan lagi', async () => {
  await app.api.put(`/categories/${coffee.id}/archive`, { archived: true });
  const archived = await find(coffee.id);
  assert.equal(archived.archived, true);
  const expense = (await app.api.get('/categories')).filter((category) => category.kind === 'expense');
  assert.equal(expense.at(-1).id, coffee.id); // arsip di urutan paling belakang
  await app.api.put(`/categories/${coffee.id}/archive`, { archived: false });
  assert.equal((await find(coffee.id)).archived, false);
});

test('tidak bisa digabung ke kategori beda jenis atau ke dirinya sendiri', async () => {
  const salary = await categoryId(app.api, 'Gaji');
  assert.equal((await app.call('POST', `/categories/${coffee.id}/delete`, { into: salary })).status, 400);
  assert.equal((await app.call('POST', `/categories/${coffee.id}/delete`, { into: coffee.id })).status, 400);
  assert.ok(await find(coffee.id)); // tidak terhapus
});

test('gabungkan: transaksi, tagihan & anggaran pindah ke kategori tujuan', async () => {
  await app.api.post(`/categories/${coffee.id}/delete`, { into: food });
  assert.equal(await find(coffee.id), undefined);
  const target = await find(food);
  assert.equal(target.usage_count, 3);
  assert.equal(target.monthly_budget, 2300000);
  const [bill] = await app.api.get('/bills');
  assert.equal(bill.category_id, food);
});

test('kategori yang sudah dipakai tidak bisa dihapus tanpa dipindah', async () => {
  const snack = await app.api.post('/categories', { name: 'Jajan', kind: 'expense' });
  const today = new Date().toLocaleDateString('sv-SE');
  await app.api.post('/transactions', { kind: 'expense', amount: 5000, account_id: account.id, category_id: snack.id, date: today });
  const { status, data } = await app.call('POST', `/categories/${snack.id}/delete`, {});
  assert.equal(status, 400);
  assert.match(data.error, /sudah dipakai/);
  assert.ok(await find(snack.id));
});

test('pindahkan ke kategori baru: kategori baru dibuat & semua isi pindah', async () => {
  const snack = (await app.api.get('/categories')).find((category) => category.name === 'Jajan');
  const { target, backupFile } = await app.api.post(`/categories/${snack.id}/delete`, {
    newCategory: { name: 'Camilan', color: '#f97316' },
  });
  assert.equal(target.name, 'Camilan');
  assert.equal(target.kind, 'expense');
  assert.equal(target.color, '#f97316');
  assert.equal(target.icon, snack.icon); // ikon lama dipakai bila tidak diisi
  assert.equal((await find(target.id)).usage_count, 1);
  assert.equal(await find(snack.id), undefined);
  assert.match(backupFile, /^sebelum-gabung-kategori-jajan-\d{8}-\d{6}\.json$/);
});

test('backup pengaman muncul di daftar backup', async () => {
  const backups = await app.api.get('/backup/auto');
  assert.ok(backups.some((file) => file.kind === 'safety' && file.name.startsWith('sebelum-gabung-kategori-')));
});

test('kategori yang belum dipakai langsung bisa dihapus tanpa backup', async () => {
  const unused = await app.api.post('/categories', { name: 'Coba', kind: 'expense' });
  const { backupFile } = await app.api.post(`/categories/${unused.id}/delete`, {});
  assert.equal(backupFile, null);
  assert.equal(await find(unused.id), undefined);
});

test('pengaturan pajak ikut menyesuaikan saat kategori digabung', async () => {
  await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance', tax_rate: 2.5 });
  const freelance = await categoryId(app.api, 'Freelance');
  const project = await app.api.post('/categories', { name: 'Proyek', kind: 'income' });
  await app.api.put('/settings', { month_start_day: 1, income_mode: 'freelance', tax_rate: 2.5, tax_category_ids: [freelance, project.id] });
  await app.api.post(`/categories/${project.id}/delete`, { into: freelance });
  assert.deepEqual((await app.api.get('/settings')).tax_category_ids, [freelance]);
});
