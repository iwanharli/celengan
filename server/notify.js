import webpush from 'web-push';
import { query } from './db.js';

// Pengingat tagihan lewat notifikasi browser (Web Push):
//   - H-1 ("besok jatuh tempo") dan hari-H ("hari ini"), sekali per tagihan per jatuh tempo
//   - dicek saat server mulai lalu tiap jam, dikirim ke semua browser yang mengaktifkan pengingat
// Notifikasi tetap muncul walau tab Celengan tertutup, selama browser & server ini berjalan.

const ICON = 'https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-3d@1.1.0/assets/1f437.webp';
const rupiah = (amount) => `Rp ${Math.round(amount).toLocaleString('id-ID')}`;

// Kunci VAPID dibuat sekali lalu disimpan di settings.
export async function vapidKeys() {
  const [settings] = await query('SELECT vapid_public, vapid_private FROM settings WHERE id = 1');
  if (settings.vapid_public) return { publicKey: settings.vapid_public, privateKey: settings.vapid_private };
  const keys = webpush.generateVAPIDKeys();
  await query('UPDATE settings SET vapid_public = $1, vapid_private = $2 WHERE id = 1', [keys.publicKey, keys.privateKey]);
  return keys;
}

// Kirim ke semua langganan; langganan yang sudah tidak berlaku (404/410) dihapus.
export async function sendToAll(payload) {
  const keys = await vapidKeys();
  const subscriptions = await query('SELECT * FROM push_subscriptions');
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        JSON.stringify({ icon: ICON, ...payload }),
        { vapidDetails: { subject: 'mailto:celengan@localhost', ...keys }, TTL: 60 * 60 * 12 },
      );
      sent += 1;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await query('DELETE FROM push_subscriptions WHERE id = $1', [subscription.id]);
      else console.error('Notifikasi gagal:', error.message);
    }
  }
  return sent;
}

// Tagihan yang perlu diingatkan sekarang (belum pernah diingatkan untuk jatuh tempo itu).
export async function dueReminders(today = new Date().toLocaleDateString('sv-SE')) {
  return query(
    `SELECT b.id, b.name, b.amount, b.next_due, b.auto_pay, a.name AS account_name,
            CASE WHEN b.next_due = $1::date THEN 'today' ELSE 'tomorrow' END AS kind
     FROM bills b LEFT JOIN accounts a ON a.id = b.account_id
     WHERE b.active AND b.next_due IN ($1::date, $1::date + 1)
       AND NOT EXISTS (
         SELECT 1 FROM bill_reminders r
         WHERE r.bill_id = b.id AND r.due_date = b.next_due
           AND r.kind = CASE WHEN b.next_due = $1::date THEN 'today' ELSE 'tomorrow' END
       )
     ORDER BY b.next_due, b.id`,
    [today],
  );
}

export function reminderMessage(bill) {
  const when = bill.kind === 'today' ? 'Hari ini' : 'Besok';
  const how = bill.auto_pay && bill.account_name ? `Dipotong otomatis dari ${bill.account_name}.` : 'Jangan lupa dibayar ya.';
  return { title: `${when} jatuh tempo: ${bill.name}`, body: `${rupiah(bill.amount)} · ${how}`, url: '/#bills', tag: `bill-${bill.id}-${bill.next_due}` };
}

export async function sendBillReminders(today) {
  const [{ count }] = await query('SELECT count(*)::int AS count FROM push_subscriptions');
  if (!count) return 0;
  const bills = await dueReminders(today);
  for (const bill of bills) {
    await sendToAll(reminderMessage(bill));
    await query('INSERT INTO bill_reminders (bill_id, due_date, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [bill.id, bill.next_due, bill.kind]);
  }
  return bills.length;
}

export function scheduleBillReminders() {
  const run = () => sendBillReminders().catch((error) => console.error('Pengingat tagihan gagal:', error.message));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
