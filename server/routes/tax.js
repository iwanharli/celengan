import { Router } from 'express';
import { withTransaction, required } from '../db.js';
import { taxStatus, taxCategoryId, taxReport } from '../tax.js';
import { toPdf } from '../pdf.js';
import { PTKP } from '../../public/js/tax-calc.js';

const router = Router();

router.get('/', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json(await taxStatus(year));
});

// Ringkasan untuk lapor SPT Tahunan. ?format=pdf → unduh PDF, selain itu JSON.
router.get('/report', async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const report = await taxReport(year);
  if (req.query.format !== 'pdf') { res.json(report); return; }

  const rp = (value) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;
  const col = (key, label, type = 'text') => ({ key, label, type });
  const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const methodText = report.method === 'nppn'
    ? `NPPN · norma ${String(report.norma).replace('.', ',')}% · PTKP ${report.ptkp} (${rp(PTKP[report.ptkp])})`
    : report.method === 'final' ? 'PPh Final 0,5% · Rp500 juta pertama bebas' : `Persentase tetap ${String(report.rate).replace('.', ',')}% dari pemasukan`;
  const datasets = [
    { key: 'clients', label: 'Penghasilan bruto per klien', columns: [col('client', 'Klien'), col('count', 'Jumlah pembayaran', 'number'),
      col('gross', 'Bruto', 'money'), col('withheld', 'PPh 21 dipotong', 'money'), col('received', 'Diterima', 'money')], rows: report.clients },
    { key: 'months', label: 'Penghasilan bruto per bulan', columns: [col('month', 'Bulan'), col('gross', 'Bruto', 'money'),
      col('withheld', 'PPh 21 dipotong', 'money')], rows: report.months.map((row) => ({ ...row, month: monthName(row.month) })) },
    { key: 'payments', label: 'Pajak yang sudah dibayar sendiri', columns: [col('date', 'Tanggal', 'date'), col('amount', 'Nominal', 'money'),
      col('account', 'Dari akun'), col('note', 'Catatan')], rows: report.payments },
  ];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="celengan-ringkasan-pajak-${year}.pdf"`);
  toPdf(datasets, { date_format: 'dmy', money_format: 'rupiah' }, {
    title: `Ringkasan pajak ${year}`,
    subtitle: `${methodText} · perkiraan, bukan perhitungan resmi`,
    cards: [
      { label: 'Penghasilan bruto', value: rp(report.taxableIncome) },
      { label: `Perkiraan pajak (${String(report.effectiveRate).replace('.', ',')}%)`, value: rp(report.owed) },
      { label: 'Dipotong klien + dibayar', value: rp(report.withheld + report.paid), tone: 'positive' },
      { label: 'Sisa yang perlu dibayar', value: rp(report.outstanding), tone: report.outstanding > 0 ? 'negative' : 'positive' },
    ],
  }).pipe(res);
});

// Bayar pajak: dicatat sebagai pengeluaran kategori "Pajak", mengurangi sisa dana pajak.
router.post('/pay', async (req, res) => {
  required(req.body, ['amount', 'account_id', 'date']);
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO transactions (kind, amount, account_id, category_id, date, note)
       VALUES ('expense', $1, $2, $3, $4, $5)`,
      [req.body.amount, req.body.account_id, await taxCategoryId(client), req.body.date, req.body.note || 'Bayar pajak'],
    );
  });
  res.status(204).end();
});

export default router;
