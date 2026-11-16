self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil((async () => {
    const scope = new URL(self.registration.scope).pathname
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const page = list.find(c => new URL(c.url).pathname.startsWith(scope))
    if (page) return page.focus()
    return self.clients.openWindow('./')
  })())
})
