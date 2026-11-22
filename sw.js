/* Static panel cache: only small, public UI assets. Never caches user inputs. */
const CACHE = "quant-comp-panels-2026-v13";
const ASSETS = [
  "./index.html",
  "./manual.css",
  "./scavenger/index.html",
  "./scavenger/manual.html",
  "./scavenger/styles.css",
  "./scavenger/app.js",
  "./scavenger/engine.js",
  "./baskets/index.html",
  "./baskets/manual.html",
  "./baskets/styles.css",
  "./baskets/app.js",
  "./baskets/engine.js",
  "./baskets/import.js",
  "./baskets/desk-engine.js",
  "./baskets/desk-ui.js",
  "./liars-market/index.html",
  "./liars-market/manual.html",
  "./liars-market/styles.css",
  "./liars-market/app.js",
  "./liars-market/engine.js",
  "./treasures-and-trash/index.html",
  "./treasures-and-trash/manual.html",
  "./treasures-and-trash/styles.css",
  "./treasures-and-trash/app.js",
  "./treasures-and-trash/engine.js",
  "./vault/index.html",
  "./vault/manual.html",
  "./vault/styles.css",
  "./vault/app.js",
  "./vault/engine.js",
  "./vault/import.js"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("quant-comp-panels-") && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request=event.request, url=new URL(request.url);
  if(request.method!=="GET" || url.origin!==self.location.origin) return;
  const isPanel=url.pathname.includes("/scavenger/") || url.pathname.includes("/baskets/") || url.pathname.includes("/liars-market/") || url.pathname.includes("/treasures-and-trash/") || url.pathname.includes("/vault/") || url.pathname.endsWith("/index.html");
  if(!isPanel && request.mode!=="navigate")return;
  event.respondWith(caches.match(request).then(async cached => {
    if(cached)return cached;
    try {
      const response=await fetch(request);
      if(response.ok) {
        const cache=await caches.open(CACHE);
        cache.put(request,response.clone());
      }
      return response;
    } catch {
      const cache=await caches.open(CACHE);
      if(url.pathname.endsWith("/scavenger/"))return cache.match("./scavenger/index.html");
      if(url.pathname.endsWith("/baskets/"))return cache.match("./baskets/index.html");
      if(url.pathname.endsWith("/liars-market/"))return cache.match("./liars-market/index.html");
      if(url.pathname.endsWith("/treasures-and-trash/"))return cache.match("./treasures-and-trash/index.html");
      if(url.pathname.endsWith("/vault/"))return cache.match("./vault/index.html");
      if(request.mode==="navigate")return cache.match("./index.html");
      throw new Error("Offline asset unavailable");
    }
  }));
});
