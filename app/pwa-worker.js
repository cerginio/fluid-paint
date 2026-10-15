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
  async function install() {
    // Never overwrite a complete release, including a same-identity reinstall.
    if (await completeCache()) return;
    const name = prefix + crypto.randomUUID();
    try {
      const cache = await caches.open(name);
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
    // Compatibility only: retain complete caches, never clean/cap them in phase 7.
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
  self.addEventListener('fetch', event => { const path = route(event.request); if (path) event.respondWith(serve(event.request, path)); });
  // ALLOW is bound to a real same-scope WindowClient and this verified release.
  self.addEventListener('message', event => {
    const data=event.data, port=event.ports?.[0];
    if (!data || typeof data.requestId !== 'string' || !port) return;
    event.waitUntil((async () => {
      if (data.type === 'STATUS') { port.postMessage({requestId:data.requestId,releaseId:inventory.releaseId,shellId:inventory.shellId,complete:!!await completeCache()}); return; }
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
  return {route, verified, install, completeCache, serve};
}
if (typeof module !== 'undefined') module.exports = {fluidPwaWorker};
