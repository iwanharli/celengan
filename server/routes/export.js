import { Router } from 'express';
import { HttpError } from '../db.js';
import { buildDatasets, previewRows, toCsv, toXlsx } from '../exporter.js';
import { toPdf } from '../pdf.js';

// Halaman Export: pratinjau & unduh file sesuai pengaturan.
// Body: { datasets, period ('all' | 'current' | 'custom'), start, end, current: { month | start,end },
//         kinds, account_ids, category_ids, format ('xlsx' | 'csv' | 'pdf'), period_label (untuk judul PDF), date_format ('dmy' | 'iso'),
//         money_format ('number' | 'rupiah'), separator (';' | ','), dataset (untuk CSV: satu data per file) }
const router = Router();

const stamp = () => new Date().toLocaleDateString('sv-SE');

router.post('/preview', async (req, res) => {
  const datasets = await buildDatasets(req.body);
  res.json(datasets.map((dataset) => ({
    key: dataset.key,
    label: dataset.label,
    count: dataset.rows.length,
    columns: dataset.columns.map((column) => column.label),
    sample: previewRows(dataset, req.body),
  })));
});

router.post('/file', async (req, res) => {
  const settings = req.body;
  if (settings.format === 'csv') {
    if (!settings.dataset) throw new HttpError(400, 'Pilih data untuk file CSV');
    const [dataset] = await buildDatasets({ ...settings, datasets: [settings.dataset] });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="celengan-${dataset.key}-${stamp()}.csv"`);
    res.send(toCsv(dataset, settings));
    return;
  }
  const datasets = await buildDatasets(settings);
  if (settings.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="celengan-laporan-${stamp()}.pdf"`);
    toPdf(datasets, settings).pipe(res);
    return;
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="celengan-export-${stamp()}.xlsx"`);
  res.send(await toXlsx(datasets, settings));
});

export default router;
