import { createApp } from './app.js';
import { scheduleAutoBackup } from './backup.js';
import { removeOrphanUploads } from './routes/attachments.js';

const port = process.env.PORT ?? 3000;
createApp().listen(port, () => {
  console.log(`Celengan berjalan di http://localhost:${port}`);
  scheduleAutoBackup(); // backup otomatis harian ke folder backups/
  removeOrphanUploads().catch((error) => console.error('Bersih-bersih foto gagal:', error.message));
});
