'use strict';
// Disposable diagnostic worker ONLY. Never imported by Gulp/app or written to dist.
const PREFIX = '/__pwa_fixture/';
const BYTE = 'fluid-pwa-phase3-cached-byte\n';
const HTML = '<!doctype html><meta charset="utf-8"><title>Disposable SW harness</title><style>body{font:15px system-ui;margin:24px;max-width:940px}pre{font:13px monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4f6;padding:12px}h1{font-size:24px}</style><h1>Fluid PWA phase 3 — fixture only</h1><pre id="byte">fluid-pwa-phase3-cached-byte</pre><pre id="report">Online fixture; production app is not controlled.</pre>';
function workerSource(version) {
  return `/* DISPOSABLE PHASE-3 FIXTURE, NOT PRODUCTION SW */
'use strict';
const version=${JSON.stringify(version)}, prefix=${JSON.stringify(PREFIX)}, cacheName='fluid-pwa-fixture-'+version;
self.addEventListener('install', event => event.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  await cache.addAll([prefix, prefix+'byte.txt']);
})()));
// Natural lifecycle: no skipWaiting or clients.claim; reload obtains control.
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || event.request.method!=='GET') return;
  if(url.pathname===prefix || url.pathname===prefix+'byte.txt')
    event.respondWith(caches.open(cacheName).then(cache=>cache.match(url.origin+url.pathname)).then(response=>response || fetch(event.request)));
});
self.addEventListener('message', event => {
  const {requestId,type}=event.data || {}, port=event.ports[0];
  if(!requestId || !port || type==='IGNORE') return;
  if(type==='STATUS') event.waitUntil((async()=>{
    // Deliberate unrelated reply proves request-ID filtering, not just port isolation.
    port.postMessage({requestId:'unrelated-'+requestId,version:'WRONG'});
    const cache=await caches.open(cacheName);
    port.postMessage({requestId,type,version,cacheName,keys:(await cache.keys()).map(r=>r.url)});
  })());
});
`;
}
function fixtureRoutes(getVersion) {
  return pathname => {
    if (pathname === '/sw.js') return {body:workerSource(getVersion()),type:'text/javascript; charset=utf-8',cache:'no-store',headers:{'Service-Worker-Allowed':PREFIX}};
    if (pathname === PREFIX) return {body:HTML,type:'text/html; charset=utf-8',cache:'no-cache'};
    if (pathname === PREFIX+'byte.txt') return {body:BYTE,type:'text/plain; charset=utf-8',cache:'no-cache'};
    return null;
  };
}
module.exports={PREFIX,BYTE,HTML,workerSource,fixtureRoutes};
