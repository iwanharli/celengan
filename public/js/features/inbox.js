import { api } from '../api.js';
import { todayISO, addDays } from '../format.js';

// Halaman Notifikasi: kotak notifikasi dari server (server/inbox.js), dikelompokkan per hari.
export default {
  inboxFilter: 'all', // 'all' | 'unread' | jenis (bill, debt, budget, asset, tax)

  get inboxItems() {
    const { items } = this.inbox;
    if (this.inboxFilter === 'all') return items;
    if (this.inboxFilter === 'unread') return items.filter((item) => !item.read_at);
    return items.filter((item) => item.kind === this.inboxFilter);
  },

  // Filter yang punya isi saja (ditambah Semua & Belum dibaca).
  get inboxFilters() {
    const kinds = Object.entries(this.NOTIFICATION_KINDS)
      .map(([id, kind]) => ({ id, ...kind, count: this.inbox.items.filter((item) => item.kind === id).length }))
      .filter((kind) => kind.count);
    return [
      { id: 'all', label: 'Semua', icon: 'tray', count: this.inbox.items.length },
      { id: 'unread', label: 'Belum dibaca', icon: 'circle', count: this.inbox.unread },
      ...kinds,
    ];
  },

  // Hari ini · Kemarin · 7 hari terakhir · Lebih lama
  get inboxGroups() {
    const today = todayISO();
    const yesterday = addDays(today, -1);
    const weekAgo = addDays(today, -7);
    const groups = [
      { key: 'today', label: 'Hari ini', items: [] },
      { key: 'yesterday', label: 'Kemarin', items: [] },
      { key: 'week', label: '7 hari terakhir', items: [] },
      { key: 'older', label: 'Lebih lama', items: [] },
    ];
    for (const item of this.inboxItems) {
      const day = new Date(item.created_at).toLocaleDateString('sv-SE');
      const index = day === today ? 0 : day === yesterday ? 1 : day > weekAgo ? 2 : 3;
      groups[index].items.push(item);
    }
    return groups.filter((group) => group.items.length);
  },

  notificationTime(item) {
    const date = new Date(item.created_at);
    const minutes = Math.round((Date.now() - date) / 60000);
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit lalu`;
    if (minutes < 24 * 60) return `${Math.round(minutes / 60)} jam lalu`;
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ', ' + date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  },

  // Klik notifikasi: tandai dibaca lalu buka halamannya.
  async openNotification(item) {
    if (!item.read_at) {
      item.read_at = new Date().toISOString();
      this.inbox.unread = Math.max(0, this.inbox.unread - 1);
      api.post(`/notifications/inbox/${item.id}/read`).catch(() => {});
    }
    if (item.page) this.goTo(item.page);
  },

  async markAllRead() {
    await api.post('/notifications/inbox/read-all');
    const now = new Date().toISOString();
    this.inbox.items.forEach((item) => { item.read_at ??= now; });
    this.inbox.unread = 0;
    this.showToast('Semua notifikasi ditandai dibaca');
  },

  async removeNotification(item) {
    await api.delete(`/notifications/inbox/${item.id}`);
    if (!item.read_at) this.inbox.unread = Math.max(0, this.inbox.unread - 1);
    this.inbox.items = this.inbox.items.filter((other) => other.id !== item.id);
  },

  async clearReadNotifications() {
    await api.delete('/notifications/inbox/read');
    this.inbox.items = this.inbox.items.filter((item) => !item.read_at);
    this.showToast('Notifikasi yang sudah dibaca dihapus');
  },
};
