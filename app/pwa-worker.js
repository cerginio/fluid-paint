'use strict';
// Serialized by the release finalizer. No source/dev registration or update UX.
function fluidPwaWorker(inventory) {
  const prefix = 'fluid-pwa-shell-v1-' + inventory.releaseId + '-';
  const marker = new URL('/__fluid_pwa_complete__', self.location.origin).href;
  const entries = new Map(inventory.entries.map(e => [e.path, e]));
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  function route(request) {
    const u = new URL(request.url);
    if (request.method !== 'GET' || u.origin !== self.location.origin || request.headers.has('authorization') || request.headers.has('range')) return null;
    if (request.mode === 'navigate') return u.pathname === '/' || u.pathname === '/index.html' ? '/index.html' : null;
    if (u.search || u.hash || u.pathname === '/index.html') return null;
    return entries.has(u.pathname) || /\.[a-f0-9]{64}\.(js|css|woff2|png|webmanifest)$/.test(u.pathname) ? u.pathname : null;
  }
  async function verified(response, entry) {
    if (response.status !== 200 || response.type === 'opaque' || response.redirected) throw new Error('PWA_STATUS ' + entry.path);
    if (/\bprivate\b/i.test(response.headers.get('cache-control') || '') || response.headers.has('set-cookie')) throw new Error('PWA_PRIVATE ' + entry.path);
    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = entry.path.slice(entry.path.lastIndexOf('.'));
    const types = {'.html':['text/html'], '.js':['text/javascript','application/javascript'], '.css':['text/css'], '.webmanifest':['application/manifest+json'], '.woff2':['font/woff2'], '.png':['image/png']};
    if (!types[ext]?.includes(mime)) throw new Error('PWA_MIME ' + entry.path);
    const bytes = await response.clone().arrayBuffer(), b = new Uint8Array(bytes), text = new TextDecoder().decode(bytes);
    if (ext === '.html' && !/^\s*<!doctype html/i.test(text)) throw new Error('PWA_FORMAT ' + entry.path);
    if ((ext === '.js' || ext === '.css') && (!text.trim() || /^\s*</.test(text))) throw new Error('PWA_FORMAT ' + entry.path);
    if (ext === '.webmanifest') { try { const m = JSON.parse(text); if (!m.name || !Array.isArray(m.icons)) throw new Error(); } catch { throw new Error('PWA_FORMAT ' + entry.path); } }
    if (ext === '.png' && (b.length < 24 || [137,80,78,71,13,10,26,10].some((v,i) => b[i] !== v) || text.slice(12,16) !== 'IHDR')) throw new Error('PWA_FORMAT ' + entry.path);
    if (ext === '.woff2' && (b.length < 48 || text.slice(0,4) !== 'wOF2' || new DataView(bytes).getUint32(8) !== b.length)) throw new Error('PWA_FORMAT ' + entry.path);
    if (b.length !== entry.size || await digest(bytes) !== entry.sha256) throw new Error('PWA_HASH ' + entry.path);
    return response;
  }
  async function completeCache() {
    for (const name of await caches.keys()) if (name.startsWith(prefix)) {
      const cache = await caches.open(name);
      if ((await cache.match(marker)) && (await cache.keys()).length === inventory.entries.length + 1) return cache;
    }
    return null;
  }
  // Durable document pins, not leases. All participating workers serialize cache
  // mutation/navigation with the same origin lock. Without Web Locks, fail safe.
  const stateCache = 'fluid-pwa-liveness-v1';
  const stateURL = new URL('/__fluid_pwa_liveness__', self.location.origin).href;
  const owned = /^fluid-pwa-shell-v1-([a-f0-9]{64})-[a-f0-9-]{36}$/;
  const locked = task => self.navigator?.locks ? self.navigator.locks.request('fluid-pwa-release-lifecycle-v1', task) : Promise.resolve(null);
  async function state() {
    const cache = await caches.open(stateCache), response = await cache.match(stateURL);
    return {cache, value:response ? await response.json() : {pins:{}, shells:{}}};
  }
  async function writeState(s) { await s.cache.put(stateURL, new Response(JSON.stringify(s.value))); }
  async function rememberDocument(id, shellId, releaseId, pending = false) {
    if (!id) return;
    await locked(async () => {
      const s = await state();
      s.value.shells[inventory.shellId] = inventory.releaseId;
      const release = releaseId || s.value.shells[shellId];
      if (release) s.value.pins[id] = {release, pending};
      await writeState(s);
    });
  }
  async function cleanup() {
    return locked(async () => {
      // Only the active worker may collect; an installing/waiting/retired worker
      // cannot infer the identity of another worker from its stable script URL.
      const s = await state();
      if (s.value.activeRelease !== inventory.releaseId || !await completeCache()) return {deferred:true};
      s.value.shells[inventory.shellId] = inventory.releaseId;
      const clients = (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(c => c.url.startsWith(self.registration.scope));
      const live = new Set(clients.map(c => c.id));
      // Unidentified (including legacy/uncontrolled) documents retain everything.
      if (clients.some(c => !s.value.pins[c.id])) { await writeState(s); return {unknown:true}; }
      for (const [id,pin] of Object.entries(s.value.pins)) {
        if (live.has(id)) pin.pending = false;
        else if (!pin.pending) delete s.value.pins[id];
      }
      await writeState(s);
      const protectedReleases = new Set([inventory.releaseId,...Object.values(s.value.pins).map(p => p.release)]);
      // A concurrent install is not garbage. Keep ALL other releases until it
      // finishes; this also protects complete waiting without cross-worker RPC.
      if (self.registration.installing || self.registration.waiting) return {candidate:true};
      const removed = [];
      for (const name of await caches.keys()) {
        const match = owned.exec(name);
        if (match && !protectedReleases.has(match[1])) { await caches.delete(name); removed.push(name); }
      }
      return {removed};
    });
  }
  async function install() {
    // Never overwrite a complete release, including a same-identity reinstall.
    if (await completeCache()) return;
    // Only cache creation participates in the collection lock. Network install
    // must not hold up STATUS/readiness of the currently working application.
    const create = async () => { const name = prefix + crypto.randomUUID(); return {name, cache:await caches.open(name)}; };
    const {name, cache} = self.navigator?.locks ? await locked(create) : await create();
    try {
      for (const entry of inventory.entries) {
        const response = await fetch(new URL(entry.path, self.location.origin).href, {cache:'no-store', credentials:'omit', redirect:'error'});
        await verified(response, entry);
        await cache.put(new URL(entry.path, self.location.origin).href, response);
      }
      // Last write is the commit record. Failure (including quota) rejects install.
      await cache.put(marker, new Response(inventory.releaseId, {headers:{'Content-Type':'text/plain'}}));
    } catch (error) { await caches.delete(name); throw error; }
  }
  async function serve(request, path) {
    const cache = await completeCache();
    const response = cache && await cache.match(new URL(path, self.location.origin).href);
    // Fail closed: a partial/evicted release never serves mixed network shell.
    if (response) return response;
    // Compatibility for live documents: committed, content-addressed bytes only.
    // Old tabs can request only content-addressed bytes, never old HTML/metadata.
    if (/\.[a-f0-9]{64}\.(js|css|woff2|png|webmanifest)$/.test(path)) {
      const expected = path.match(/\.([a-f0-9]{64})\.[^.]+$/)[1];
      for (const name of await caches.keys()) {
        if (name.startsWith(prefix) || !/^fluid-pwa-shell-v1-[a-f0-9]{64}-/.test(name)) continue;
        const old = await caches.open(name);
        const committed = await old.match(marker);
        if (!committed || await committed.text() !== name.slice('fluid-pwa-shell-v1-'.length,'fluid-pwa-shell-v1-'.length+64)) continue;
        const asset = await old.match(new URL(path,self.location.origin).href);
        if (asset && await digest(await asset.clone().arrayBuffer()) === expected) return asset;
      }
    }
    // Unknown hash-shaped assets are still uncached network-only, never HTML fallback.
    if (path !== '/index.html' && !entries.has(path)) return fetch(request);
    return Response.error();
  }
  self.addEventListener('install', event => event.waitUntil(install()));
  self.addEventListener('activate', event => event.waitUntil((async () => {
    await locked(async () => { const s = await state(); s.value.activeRelease = inventory.releaseId; s.value.shells[inventory.shellId] = inventory.releaseId; await writeState(s); });
    await cleanup();
  })().catch(() => {})));
  self.addEventListener('fetch', event => {
    const path = route(event.request);
    if (path) event.respondWith((async () => {
      // Pin the reserved destination BEFORE returning old HTML, even while it
      // is not execution-ready / absent from matchAll. Pending never expires.
      if (path === '/index.html') await rememberDocument(event.resultingClientId, null, inventory.releaseId, true);
      return serve(event.request, path);
    })());
  });
  // ALLOW is bound to a real same-scope WindowClient and this verified release.
  self.addEventListener('message', event => {
    const data=event.data, port=event.ports?.[0];
    if (!data || typeof data.requestId !== 'string' || !port) return;
    event.waitUntil((async () => {
      if (data.type === 'STATUS') {
        const source = event.source?.id && await self.clients.get(event.source.id);
        let collected = null;
        try {
          if (source?.type === 'window' && source.url.startsWith(self.registration.scope)) await rememberDocument(source.id, data.documentShellId);
          collected = await cleanup();
        } catch { /* Storage/liveness failure defers collection, never readiness. */ }
        port.postMessage({requestId:data.requestId,releaseId:inventory.releaseId,shellId:inventory.shellId,buildTime:inventory.buildTime,complete:!!await completeCache(),cleanup:collected}); return;
      }
      const source=event.source?.id && await self.clients.get(event.source.id);
      if (!source || source.type !== 'window' || !source.url.startsWith(self.registration.scope) || data.releaseId !== inventory.releaseId || !await completeCache()) { port.postMessage({requestId:data.requestId,allowed:false}); return; }
      if (data.type === 'CLIENTS') {
        const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
        port.postMessage({requestId:data.requestId,allowed:true,count:clients.filter(c=>c.url.startsWith(self.registration.scope)).length});
      } else if (data.type === 'ALLOW_UPDATE') {
        port.postMessage({requestId:data.requestId,allowed:true});
        await self.skipWaiting();
      }
    })());
  });
  return {route, verified, install, completeCache, serve, cleanup, rememberDocument};
}
if (typeof module !== 'undefined') module.exports = {fluidPwaWorker};
