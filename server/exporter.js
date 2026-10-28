import ExcelJS from 'exceljs';
import { query, HttpError } from './db.js';
import { periodFromQuery } from './period.js';

// Export data sesuai pengaturan di halaman Export.
// Setiap "dataset" = { key, label, columns: [{ key, label, type }], rows }.
// type: 'date' | 'money' | 'number' | 'text' — menentukan cara nilai ditulis ke file.

const KIND_LABELS = {
  income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer', adjustment: 'Penyesuaian',
  debt_in: 'Utang masuk', debt_out: 'Utang keluar', asset_in: 'Jual aset', asset_out: 'Beli aset',
};
const ACCOUNT_TYPES = { cash: 'Tunai', bank: 'Bank', ewallet: 'E-Wallet' };
const FREQUENCIES = { weekly: 'Mingguan', monthly: 'Bulanan', yearly: 'Tahunan' };
const DEBT_TYPES = { personal: 'Pribadi', invoice: 'Invoice klien', loan: 'Pinjaman', paylater: 'Paylater', credit_card: 'Kartu kredit' };
const ASSET_TYPES = {
  gold: 'Emas', mutual_fund: 'Reksa dana', stock: 'Saham', crypto: 'Kripto', deposit: 'Deposito',
  property: 'Properti', vehicle: 'Kendaraan', other: 'Lainnya',
};
const WISH_STATUS = { wanted: 'Diinginkan', bought: 'Terbeli / tercapai', cancelled: 'Dibatalkan' };

export const DATASETS = {
  transactions: 'Transaksi',
  accounts: 'Akun',
  bills: 'Tagihan',
  debts: 'Utang & piutang',
  installments: 'Jadwal cicilan',
  assets: 'Aset',
  wishlist: 'Wishlist',
  wishlist_parts: 'Rincian wishlist',
  budgets: 'Anggaran',
  categories: 'Kategori',
};

const col = (key, label, type = 'text') => ({ key, label, type });

async function transactionsDataset(settings) {
  const params = [];
  const where = [];
  if (settings.period !== 'all') {
    const { start, end } = await periodFromQuery(settings.period === 'custom' ? settings : settings.current ?? {});
    params.push(start, end);
    where.push(`t.date >= $${params.length - 1} AND t.date < $${params.length}`);
  }
  if (settings.kinds?.length) { params.push(settings.kinds); where.push(`t.kind = ANY($${params.length})`); }
  if (settings.account_ids?.length) {
    params.push(settings.account_ids.map(Number));
    where.push(`(t.account_id = ANY($${params.length}) OR t.to_account_id = ANY($${params.length}))`);
  }
  if (settings.category_ids?.length) { params.push(settings.category_ids.map(Number)); where.push(`t.category_id = ANY($${params.length})`); }

  const rows = await query(
    `SELECT t.date, t.kind, t.amount, a.name AS account, ta.name AS to_account, c.name AS category,
            COALESCE(t.client, d.counterparty, s.name) AS related, t.note,
            (SELECT count(*)::int FROM transaction_attachments x WHERE x.transaction_id = t.id) AS photos
     FROM transactions t
     JOIN accounts a        ON a.id = t.account_id
     LEFT JOIN accounts ta  ON ta.id = t.to_account_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN debts d      ON d.id = t.debt_id
     LEFT JOIN assets s     ON s.id = t.asset_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.date, t.id`,
    params,
  );
  return {
    columns: [
      col('date', 'Tanggal', 'date'), col('kind', 'Jenis'), col('amount', 'Nominal', 'money'),
      col('account', 'Akun'), col('to_account', 'Ke akun'), col('category', 'Kategori'),
      col('related', 'Klien / terkait'), col('note', 'Catatan'), col('photos', 'Jumlah foto', 'number'),
    ],
    rows: rows.map((row) => ({ ...row, raw_kind: row.kind, kind: KIND_LABELS[row.kind] })),
  };
}

const BUILDERS = {
  transactions: transactionsDataset,

  accounts: async () => ({
    columns: [
      col('name', 'Nama'), col('type', 'Jenis'), col('provider', 'Bank / penyedia'), col('account_number', 'No. rekening / HP'),
      col('holder_name', 'Atas nama'), col('initial_balance', 'Saldo awal', 'money'), col('balance', 'Saldo sekarang', 'money'), col('note', 'Catatan'),
    ],
    rows: (await query('SELECT * FROM account_balances ORDER BY id')).map((row) => ({ ...row, type: ACCOUNT_TYPES[row.type] })),
  }),

  bills: async () => ({
    columns: [
      col('name', 'Nama'), col('amount', 'Nominal', 'money'), col('frequency', 'Frekuensi'), col('next_due', 'Jatuh tempo berikutnya', 'date'),
      col('category', 'Kategori'), col('account', 'Dibayar dari'), col('debt', 'Cicilan utang'),
    ],
    rows: (await query(
      `SELECT b.*, c.name AS category, a.name AS account, d.counterparty AS debt
       FROM bills b LEFT JOIN categories c ON c.id = b.category_id LEFT JOIN accounts a ON a.id = b.account_id
       LEFT JOIN debts d ON d.id = b.debt_id WHERE b.active ORDER BY b.next_due`,
    )).map((row) => ({ ...row, frequency: FREQUENCIES[row.frequency] })),
  }),

  debts: async () => ({
    columns: [
      col('direction', 'Arah'), col('type', 'Jenis'), col('counterparty', 'Pihak'), col('principal', 'Pokok', 'money'),
      col('total_amount', 'Total harus dibayar', 'money'), col('paid', 'Sudah dibayar', 'money'), col('remaining', 'Sisa', 'money'),
      col('installment', 'Cicilan / bulan', 'money'), col('tenor', 'Tenor (bulan)', 'number'), col('due_date', 'Jatuh tempo', 'date'), col('note', 'Catatan'),
    ],
    rows: (await query('SELECT * FROM debt_status ORDER BY id')).map((row) => ({
      ...row, direction: row.direction === 'payable' ? 'Utang' : 'Piutang', type: DEBT_TYPES[row.type],
    })),
  }),

  installments: async () => ({
    columns: [col('debt', 'Utang / piutang'), col('number', 'Cicilan ke', 'number'), col('due_date', 'Jatuh tempo', 'date'), col('amount', 'Nominal', 'money')],
    rows: await query(
      `SELECT d.counterparty AS debt, i.number, i.due_date, i.amount
       FROM debt_installments i JOIN debts d ON d.id = i.debt_id ORDER BY d.id, i.number`,
    ),
  }),

  assets: async () => ({
    columns: [
      col('name', 'Nama'), col('type', 'Jenis'), col('invested', 'Modal', 'money'),
      col('current_value', 'Nilai sekarang', 'money'), col('gain', 'Untung / rugi', 'money'), col('note', 'Catatan'),
    ],
    rows: (await query('SELECT * FROM asset_status ORDER BY id')).map((row) => ({
      ...row, type: ASSET_TYPES[row.type] ?? row.type, gain: row.current_value - row.invested,
    })),
  }),

  wishlist: async () => ({
    columns: [
      col('name', 'Nama'), col('kind', 'Jenis'), col('status', 'Status'), col('price', 'Target', 'money'),
      col('saved', 'Disisihkan', 'money'), col('paid', 'Dibayar lewat rincian', 'money'), col('target_date', 'Target tanggal', 'date'),
      col('bought_at', 'Tanggal terbeli / tercapai', 'date'), col('note', 'Catatan'),
    ],
    rows: (await query(
      `SELECT w.*, COALESCE((SELECT SUM(t.amount) FROM transactions t JOIN wishlist_parts p ON p.id = t.wish_part_id
                             WHERE p.item_id = w.id AND t.kind = 'expense'), 0)::bigint AS paid
       FROM wishlist_items w ORDER BY w.id`,
    )).map((row) => ({ ...row, status: WISH_STATUS[row.status] })),
  }),

  wishlist_parts: async () => ({
    columns: [col('item', 'Wishlist'), col('name', 'Rincian'), col('amount', 'Biaya', 'money'), col('paid', 'Sudah dibayar', 'money'), col('note', 'Catatan')],
    rows: await query(
      `SELECT w.name AS item, p.name, p.amount, p.note,
              COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.wish_part_id = p.id AND t.kind = 'expense'), 0)::bigint AS paid
       FROM wishlist_parts p JOIN wishlist_items w ON w.id = p.item_id ORDER BY w.id, p.position`,
    ),
  }),

  budgets: async () => ({
    columns: [col('name', 'Kategori'), col('monthly_budget', 'Anggaran / bulan', 'money'), col('budget_percent', '% dari pemasukan', 'number')],
    rows: await query(
      `SELECT name, monthly_budget, budget_percent FROM categories
       WHERE kind = 'expense' AND (monthly_budget IS NOT NULL OR budget_percent IS NOT NULL) ORDER BY id`,
    ),
  }),

  categories: async () => ({
    columns: [col('name', 'Nama'), col('kind', 'Jenis'), col('archived', 'Diarsipkan'), col('usage', 'Jumlah transaksi', 'number')],
    rows: (await query(
      `SELECT c.name, c.kind, c.archived, (SELECT count(*)::int FROM transactions t WHERE t.category_id = c.id) AS usage
       FROM categories c ORDER BY c.kind DESC, c.id`,
    )).map((row) => ({ ...row, kind: row.kind === 'income' ? 'Pemasukan' : 'Pengeluaran', archived: row.archived ? 'Ya' : '' })),
  }),
};

export async function buildDatasets(settings) {
  const keys = (settings.datasets ?? []).filter((key) => BUILDERS[key]);
  if (keys.length === 0) throw new HttpError(400, 'Pilih minimal satu data untuk diekspor');
  return Promise.all(keys.map(async (key) => ({ key, label: DATASETS[key], ...(await BUILDERS[key](settings)) })));
}

// ---------- Format nilai ----------

export function formatValue(value, type, settings, forExcel = false) {
  if (value === null || value === undefined || value === '') return forExcel ? null : '';
  if (type === 'date') {
    const iso = String(value).slice(0, 10);
    if (forExcel) return new Date(`${iso}T00:00:00Z`);
    return settings.date_format === 'dmy' ? iso.split('-').reverse().join('/') : iso;
  }
  if (type === 'money') {
    if (forExcel) return Number(value);
    return settings.money_format === 'rupiah'
      ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value).replace(/\s/g, ' ')
      : String(value);
  }
  return forExcel && type === 'number' ? Number(value) : String(value);
}

export function previewRows(dataset, settings, limit = 5) {
  return dataset.rows.slice(0, limit).map((row) => dataset.columns.map((column) => formatValue(row[column.key], column.type, settings)));
}

// ---------- CSV ----------

export function toCsv(dataset, settings) {
  const separator = settings.separator === ',' ? ',' : ';';
  const cell = (value) => {
    const text = String(value ?? '');
    return text.includes(separator) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    dataset.columns.map((column) => cell(column.label)).join(separator),
    ...dataset.rows.map((row) => dataset.columns.map((column) => cell(formatValue(row[column.key], column.type, settings))).join(separator)),
  ];
  return '﻿' + lines.join('\r\n'); // BOM: huruf & simbol tampil benar di Excel
}

// ---------- Excel ----------

export async function toXlsx(datasets, settings) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Celengan';
  workbook.created = new Date();

  for (const dataset of datasets) {
    const sheet = workbook.addWorksheet(dataset.label.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = dataset.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(12, column.label.length + 4, column.type === 'text' ? 22 : 16),
      style: column.type === 'money'
        ? { numFmt: settings.money_format === 'rupiah' ? '"Rp" #,##0' : '#,##0' }
        : column.type === 'date' ? { numFmt: settings.date_format === 'dmy' ? 'dd/mm/yyyy' : 'yyyy-mm-dd' } : {},
    }));
    for (const row of dataset.rows) {
      sheet.addRow(Object.fromEntries(dataset.columns.map((column) => [column.key, formatValue(row[column.key], column.type, settings, true)])));
    }
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5CF6' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
    if (dataset.rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: dataset.columns.length } };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
