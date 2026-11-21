// 3DParter service worker. Built by the `precache` plugin in vite.config.ts, which fills in the two tokens below.
// - Precaches the app shell, every hashed asset, the OpenCascade .wasm and the fonts, so the app opens offline.
// - index.html (navigations): network first, falls back to the cached shell.
// - Everything else from this origin: cache first.
// A new version installs in the background and waits until every open tab is closed, so a running page never loses its chunks.
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = `3dparter-${VERSION}`
const SHELL = '/index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('3dparter-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE)
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
    if (res.ok) cache.put(SHELL, res.clone())
    return res
  } catch {
    return (await cache.match(SHELL, { ignoreVary: true })) ?? Response.error()
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request, { ignoreSearch: true, ignoreVary: true })
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok && new URL(request.url).pathname.startsWith('/assets/')) {
    const cache = await caches.open(CACHE)
    cache.put(request, res.clone())
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
  } else if (url.pathname !== '/sw.js') {
    event.respondWith(cacheFirst(request))
  }
})
