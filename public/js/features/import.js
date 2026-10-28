import { api } from '../api.js';
import { findHeader, guessMapping, parseStatement } from '../statement.js';

// Import mutasi rekening (CSV / Excel dari internet banking) → transaksi.
// 1. pilih akun & file  2. kolom dikenali otomatis (bisa diubah)  3. cek kategori & duplikat  4. import.
// Library pembaca file dimuat saat dibutuhkan saja.
const loadPapa = () => import('https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm').then((m) => m.default);
const loadXlsx = () => import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');

async function readRows(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await loadXlsx();
    const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }
  const Papa = await loadPapa();
  return Papa.parse(await file.text(), { skipEmptyLines: false }).data;
}

export const IMPORT_COLUMNS = [
  ['date', 'Tanggal'], ['note', 'Keterangan'], ['amount', 'Nominal (satu kolom)'], ['debit', 'Debit / keluar'], ['credit', 'Kredit / masuk'], ['type', 'Jenis DB/CR'],
];

export default {
  IMPORT_COLUMNS,

  openImport() {
    this.open('import', {
      step: 'file', account_id: this.defaultAccountId, year: new Date().getFullYear(),
      fileName: '', raw: [], headerIndex: 0, header: [], mapping: {}, items: [], loading: false,
    });
  },

  async pickImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.form.loading = true;
    try {
      const raw = (await readRows(file)).filter((row) => Array.isArray(row));
      const headerIndex = findHeader(raw);
      Object.assign(this.form, { fileName: file.name, raw, headerIndex, header: raw[headerIndex] ?? [], mapping: guessMapping(raw[headerIndex] ?? []) });
      await this.refreshImportPreview();
    } catch (error) {
      this.formError = `File tidak bisa dibaca: ${error.message}`;
    } finally {
      this.form.loading = false;
    }
  },

  // Dipanggil juga saat kolom / tahun diubah.
  async refreshImportPreview() {
    const mapping = Object.fromEntries(Object.entries(this.form.mapping).map(([key, value]) => [key, Number(value)]));
    const rows = parseStatement(this.form.raw, this.form.headerIndex, mapping, Number(this.form.year));
    this.form.step = 'review';
    if (rows.length === 0) { this.form.items = []; return; }
    const preview = await api.post('/import/preview', { account_id: Number(this.form.account_id), rows });
    this.form.items = preview.map((row, index) => ({ ...row, id: index, selected: !row.duplicate }));
  },

  get importSelected() {
    return (this.form.items ?? []).filter((item) => item.selected);
  },

  get importTotals() {
    const sum = (kind) => this.importSelected.filter((item) => item.kind === kind).reduce((total, item) => total + item.amount, 0);
    return { income: sum('income'), expense: sum('expense') };
  },

  toggleImportKind(item) {
    item.kind = item.kind === 'income' ? 'expense' : 'income';
    item.category_id = this.categoriesOf(item.kind)[0]?.id ?? null;
  },

  setAllImport(selected) {
    this.form.items.forEach((item) => { item.selected = selected; });
  },

  saveImport() {
    const rows = this.importSelected.map(({ date, note, amount, kind, category_id }) => ({ date, note, amount, kind, category_id: Number(category_id) }));
    const account = this.accounts.find((a) => a.id === Number(this.form.account_id));
    return this.submit(async () => {
      if (!rows.length) throw new Error('Pilih minimal satu transaksi');
      await api.post('/import', { account_id: Number(this.form.account_id), rows });
    }, `✅ ${rows.length} transaksi diimport ke ${account?.name ?? 'akun'}`, 'small');
  },
};
