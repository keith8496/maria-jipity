// service-worker.js
// -------------------------------------------------------------
// ALPHA MODE: CACHING DISABLED
// TODO: Re-enable proper caching + versioning before production.
// -------------------------------------------------------------

self.addEventListener("install", (event) => {
  // Immediately activate the updated SW
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all pages immediately
  event.waitUntil(self.clients.claim());
});

// Network-only fetch handler — disables all caching
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});