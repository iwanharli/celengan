import express from 'express';
import { appHtml } from './views.js';
import accounts from './routes/accounts.js';
import categories from './routes/categories.js';
import transactions from './routes/transactions.js';
import bills from './routes/bills.js';
import debts from './routes/debts.js';
import summary from './routes/summary.js';
import settings from './routes/settings.js';
import assets from './routes/assets.js';
import exportRoutes from './routes/export.js';
import wishlist from './routes/wishlist.js';
import backup from './routes/backup.js';
import tax from './routes/tax.js';
import templates from './routes/templates.js';
import recipients from './routes/recipients.js';
import notifications from './routes/notifications.js';
import reports from './routes/reports.js';
import attachments from './routes/attachments.js';
import auth, { requireLogin } from './routes/auth.js';

// Aplikasi Express tanpa listen(), supaya bisa dipakai oleh server maupun test otomatis.
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '25mb' })); // besar karena restore backup dikirim sebagai JSON

  // Halaman utama disusun dari views/ (layout + halaman + komponen).
  // no-cache: browser boleh menyimpan, tapi selalu mengecek versi terbaru (ETag) — supaya tampilan
  // tidak tertinggal setelah file diperbarui.
  app.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-cache').type('html').send(await appHtml());
  });
  app.use(express.static(new URL('../public', import.meta.url).pathname, {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  }));

  // Endpoint login terbuka; semua endpoint data di bawahnya wajib login.
  app.use('/api/auth', auth);
  app.use('/api', requireLogin);

  app.use('/api', attachments); // /api/transactions/:id/attachments & /api/attachments/:id
  app.use('/api/accounts', accounts);
  app.use('/api/categories', categories);
  app.use('/api/transactions', transactions);
  app.use('/api/bills', bills);
  app.use('/api/debts', debts);
  app.use('/api/summary', summary);
  app.use('/api/settings', settings);
  app.use('/api/assets', assets);
  app.use('/api/export', exportRoutes);
  app.use('/api/wishlist', wishlist);
  app.use('/api/backup', backup);
  app.use('/api/tax', tax);
  app.use('/api/templates', templates);
  app.use('/api/recipients', recipients);
  app.use('/api/notifications', notifications);
  app.use('/api/reports', reports);

  // Express 5 otomatis meneruskan error dari handler async ke sini.
  app.use((error, req, res, next) => {
    const isValidationError = error.code?.startsWith('23') || error.code?.startsWith('22');
    const status = error.status ?? (isValidationError ? 400 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan di server' : error.message });
  });

  return app;
}
