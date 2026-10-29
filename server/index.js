import { createApp } from './app.js';
import { scheduleAutoBackup } from './backup.js';
import { removeOrphanUploads } from './routes/attachments.js';
import { scheduleBillReminders } from './notify.js';
import { scheduleWalletSync } from './routes/assets.js';
import { scheduleNotifications } from './inbox.js';

const port = process.env.PORT ?? 3000;
createApp().listen(port, () => {
  console.log(`Celengan berjalan di http://localhost:${port}`);
  scheduleAutoBackup(); // backup otomatis harian ke folder backups/
  scheduleBillReminders(); // pengingat tagihan H-1 & hari-H lewat notifikasi browser
  scheduleNotifications(); // kotak notifikasi: diperiksa tiap 15 menit
  scheduleWalletSync(); // nilai wallet kripto diperbarui tiap 10 menit
  removeOrphanUploads().catch((error) => console.error('Bersih-bersih foto gagal:', error.message));
});
