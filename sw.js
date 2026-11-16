// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Service worker: deja la app disponible sin conexión. La versión vive en version.js.
importScripts('version.js');
const SHELL_CACHE = `reports2-shell-v${self.APP_VERSION}`;
const NETWORK_TIMEOUT_MS = 4000;
const SHELL_URLS = [
    './', './index.html', './manifest.webmanifest', './version.js',
    './css/app.css', './css/ios.css',
    './js/app.js', './js/sections.js', './js/update.js',
    './vendor/pdf-3.11.174.min.js', './vendor/pdf.worker-3.11.174.min.js', './vendor/pdf-lib-1.17.1.min.js',
    './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
    './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const shell = await caches.open(SHELL_CACHE);
        await shell.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith('reports2-shell-') && n !== SHELL_CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    if (new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(request.mode === 'navigate' ? networkFirst(request, event) : staleWhileRevalidate(request, event));
});

async function networkFirst(request, event) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS))]);
        if (response.ok) event.waitUntil(cache.put(request, response.clone()));
        return response;
    } catch (error) {
        return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
    }
}

async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const update = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    });
    if (cached) { event.waitUntil(update.catch(() => {})); return cached; }
    return update;
}
