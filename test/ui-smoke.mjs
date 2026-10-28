// Uji tampilan: buka setiap halaman & setiap modal di Chrome (headless), gagal kalau ada error JavaScript
// atau error ekspresi Alpine (misal fungsi yang dipanggil tombol tidak ada, properti undefined).
//
//   npm run test:ui          (butuh Google Chrome; memakai database test, bukan data kamu)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp } from './helpers.js';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.log(`Chrome tidak ditemukan di ${CHROME}. Atur CHROME_PATH lalu ulangi.`);
  process.exit(0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Data contoh supaya setiap halaman & modal punya isi ----------
const app = await startTestApp();
const { api } = app;
await api.put('/settings', { month_start_day: 1, income_mode: 'freelance', tax_method: 'nppn', tax_norma: 50, tax_ptkp: 'TK/0' });
const today = new Date().toLocaleDateString('sv-SE');
const categories = await api.get('/categories');
const category = (name) => categories.find((c) => c.name === name).id;
const bca = await api.post('/accounts', { name: 'BCA', type: 'bank', initial_balance: 5000000, provider: 'BCA', account_number: '1234567890' });
const gopay = await api.post('/accounts', { name: 'GoPay', type: 'ewallet', initial_balance: 100000 });
const expense = await api.post('/transactions', { kind: 'expense', amount: 25000, account_id: bca.id, category_id: category('Makan & Minum'), date: today, note: 'Kopi' });
await api.post('/transactions', { kind: 'income', amount: 9750000, account_id: bca.id, category_id: category('Freelance'), date: today, client: 'PT Maju', tax_withheld: 250000 });
const transfer = await api.post('/transactions', { kind: 'transfer', amount: 50000, account_id: bca.id, to_account_id: gopay.id, date: today, fee: 1000 });
const bill = await api.post('/bills', { name: 'Netflix', amount: 65000, frequency: 'monthly', next_due: today, category_id: category('Hiburan'), account_id: bca.id });
const debt = await api.post('/debts', { direction: 'payable', type: 'paylater', counterparty: 'SPayLater', principal: 1200000, total_amount: 1500000, tenor: 6, first_due: today, account_id: bca.id });
const invoice = await api.post('/debts', { direction: 'receivable', type: 'invoice', counterparty: 'CV Kecil', principal: 3000000 });
const asset = await api.post('/assets', { name: 'Emas', type: 'gold', initial_cost: 1000000, current_value: 1100000 });
const wish = await api.post('/wishlist', { name: 'Sepatu', price: 900000 });
const recipient = await api.post('/recipients', { name: 'Ibu', relation: 'parent', method: 'bank', provider: 'BRI', account_number: '1111222233' });

// ---------- Chrome lewat DevTools protocol ----------
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1400,1000',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'celengan-ui-'))}`, 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i += 1) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
let nextId = 0;
const pending = new Map();
const problems = [];
let where = 'awal';
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message.result ?? message.error); return; }
  if (message.method === 'Runtime.exceptionThrown') {
    problems.push(`[${where}] ${(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).split('\n')[0]}`);
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    const text = message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    if (/Alpine|Error|undefined/i.test(text)) problems.push(`[${where}] ${text.split('\n')[0]}`);
  }
});
const send = (method, params = {}) => new Promise((resolve) => { pending.set(++nextId, resolve); ws.send(JSON.stringify({ id: nextId, method, params })); });
const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

await send('Runtime.enable');
await send('Network.setCookie', { name: 'sid', value: app.token, url: app.baseUrl });
await send('Page.navigate', { url: `${app.baseUrl}/#home` });
await sleep(4000);
const component = "document.querySelector('[x-data]')._x_dataStack[0]";

// Setiap halaman.
const pages = ['home', 'transactions', 'budget', 'bills', 'recipients', 'categories', 'accounts', 'assets', 'debts', 'wishlist', 'reports', 'export', 'settings'];
for (const page of pages) {
  where = `halaman ${page}`;
  await evaluate(`${component}.goTo('${page}')`);
  await sleep(1200);
}
for (const section of ['income', 'tax', 'notify', 'data', 'security', 'danger']) {
  where = `pengaturan ${section}`;
  await evaluate(`${component}.goToSettings('${section}')`);
  await sleep(500);
}

// Setiap modal (dibuka dengan data contoh, lalu ditutup).
const find = (list, id) => `${component}.${list}.find((x) => x.id === ${id})`;
const modals = {
  'transaksi baru': 'd.openTransaction()',
  'pemasukan': "d.openTransaction('income')",
  'transfer': "d.openTransaction('transfer')",
  'edit transaksi': `d.openEditTransaction(${find('transactions', expense.id)} ?? d.summary.recent[0])`,
  'edit transfer': `d.openEditTransaction(${find('transactions', transfer.id)} ?? d.summary.recent[0])`,
  'riwayat transaksi': `d.openTransactionHistory(d.summary.recent[0])`,
  'baru dihapus': 'd.openDeletedTransactions()',
  'akun': 'd.openAccount()',
  'edit akun': `d.openAccount(${find('accounts', bca.id)})`,
  'sesuaikan saldo': `d.openAdjust(${find('accounts', bca.id)})`,
  'tagihan': 'd.openBill()',
  'bayar tagihan': `d.openPayBill(${find('bills', bill.id)})`,
  'riwayat tagihan': `d.openBillHistory(${find('bills', bill.id)})`,
  'utang': 'd.openDebt()',
  'invoice': 'd.openInvoice()',
  'edit utang': `d.openEditDebt(${find('debts', debt.id)})`,
  'jadwal cicilan': `d.openSchedule(${find('debts', debt.id)})`,
  'riwayat utang': `d.openDebtHistory(${find('debts', debt.id)})`,
  'bayar utang': `d.openPayDebt(${find('debts', debt.id)})`,
  'terima invoice': `d.openPayDebt(${find('debts', invoice.id)})`,
  'aset': 'd.openAsset()',
  'nilai aset': `d.openAssetValue(${find('assets.assets', asset.id)})`,
  'beli aset': `d.openAssetTrade(${find('assets.assets', asset.id)}, 'buy')`,
  'wishlist': 'd.openWish()',
  'edit wishlist': `d.openWish(${find('wishlist', wish.id)})`,
  'sisihkan wishlist': `d.openWishSave(${find('wishlist', wish.id)})`,
  'beli wishlist': `d.openWishBuy(${find('wishlist', wish.id)})`,
  'riwayat wishlist': `d.openWishHistory(${find('wishlist', wish.id)})`,
  'kategori': "d.openCategory('expense')",
  'anggaran': `d.openBudget(d.summary.categories[0])`,
  'penerima': 'd.openRecipient()',
  'edit penerima': `d.openRecipient(${find('recipients', recipient.id)})`,
  'kirim ke penerima': `d.sendToRecipient(${find('recipients', recipient.id)})`,
  'riwayat penerima': `d.openRecipientHistory(${find('recipients', recipient.id)})`,
  'bayar pajak': 'd.openTaxPay()',
  'pilih periode': 'd.openPeriodPicker()',
  'mulai dari nol': 'd.openReset()',
};
// Modal butuh data halamannya: buka halaman terkait dulu.
const pageFor = (name) => (/utang|invoice|cicilan/.test(name) ? 'debts' : /aset/.test(name) ? 'assets' : /wishlist/.test(name) ? 'wishlist'
  : /tagihan/.test(name) ? 'bills' : /transaksi|transfer|pemasukan|dihapus/.test(name) ? 'transactions' : /penerima/.test(name) ? 'recipients' : 'home');
for (const [name, open] of Object.entries(modals)) {
  where = `modal ${name}`;
  await evaluate(`${component}.goTo('${pageFor(name)}')`);
  await sleep(700);
  const result = await evaluate(`(async () => { const d = ${component}; await (${open}); await new Promise((r) => setTimeout(r, 500)); const ok = Boolean(d.modal); d.close(); return ok; })()`);
  if (result?.result?.value !== true) problems.push(`[${where}] modal tidak terbuka (${result?.exceptionDetails?.exception?.description ?? 'tanpa pesan'})`);
}

ws.close();
chrome.kill();
await app.close();

if (problems.length) {
  console.error(`✗ ${problems.length} masalah tampilan:\n${[...new Set(problems)].map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ ${pages.length} halaman & ${Object.keys(modals).length} modal terbuka tanpa error`);
