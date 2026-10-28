import { api } from '../api.js';

// Pengingat tagihan lewat notifikasi browser (Web Push). Server mengirim H-1 & hari-H (server/notify.js);
// browser menampilkannya lewat service worker (public/sw.js), walau tab Celengan tertutup.

// Kunci publik VAPID (base64url) → Uint8Array untuk pushManager.subscribe.
function keyBytes(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export default {
  pushState: 'loading', // on | off | blocked | unsupported | loading
  pushDevices: 0,

  async loadPushState() {
    if (!supported()) { this.pushState = 'unsupported'; return; }
    try {
      const [{ devices }, registration] = await Promise.all([api.get('/notifications'), navigator.serviceWorker.register('/sw.js')]);
      this.pushDevices = devices;
      const subscription = await registration.pushManager.getSubscription();
      this.pushState = Notification.permission === 'denied' ? 'blocked' : subscription ? 'on' : 'off';
    } catch {
      this.pushState = 'unsupported';
    }
  },

  async enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { this.pushState = permission === 'denied' ? 'blocked' : 'off'; return; }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await api.get('/notifications');
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await api.post('/notifications/subscribe', { subscription: subscription.toJSON(), device: navigator.userAgent });
      this.showToast('🔔 Pengingat tagihan aktif');
      await this.loadPushState();
    } catch (error) {
      this.formError = `Gagal mengaktifkan notifikasi: ${error.message}`;
    }
  },

  async disablePush() {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api.post('/notifications/unsubscribe', { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    this.showToast('Pengingat dimatikan di browser ini');
    await this.loadPushState();
  },

  async sendTestNotification() {
    try {
      await api.post('/notifications/test');
      this.showToast('Notifikasi tes dikirim');
    } catch (error) {
      this.formError = error.message;
    }
  },
};
