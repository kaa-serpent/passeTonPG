/* Public application shell only. Personal data never enters Cache Storage. */
const BUILD = "b4a1dd1d-7124-42da-97df-767fc1d23312";
const CACHE = `passetonpg-shell-${BUILD}`;
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Also retain initial JS/CSS before the worker controls the first page.
    const html = await (await cache.match("/")).text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1].replaceAll("&amp;", "&")))];
    await Promise.all(assets.map(async asset => {
      const url = new URL(asset, self.location.origin);
      if (url.origin === self.location.origin) await cache.add(url.pathname + url.search);
    }));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("passetonpg-shell-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await (await caches.open(CACHE)).put("/", response.clone());
        return response;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || SHELL.includes(url.pathname) && url.pathname !== "/") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    })());
  }
});
