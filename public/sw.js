// Service worker Celengan: menampilkan pengingat tagihan (Web Push) walau tab sedang tertutup.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title ?? 'Celengan', {
    body: data.body, icon: data.icon, badge: data.icon, tag: data.tag, data: { url: data.url ?? '/' },
  }));
});

// Klik notifikasi: buka tab Celengan yang sudah ada, atau buka yang baru.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find((client) => client.url.startsWith(self.location.origin));
    if (tab) { await tab.focus(); return tab.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
