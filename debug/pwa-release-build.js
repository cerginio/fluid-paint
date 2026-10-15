'use strict';
// Build-only production finalizer; serializes the pinned production SW last.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function canonicalInventory(entries) {
  const seen = new Set();
  const pairs = entries.map(({ path: url, sha256: digest }) => {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(url) || url.includes('//') || url.split('/').some(p => p === '.' || p === '..') || seen.has(url)) throw new Error(`Invalid/duplicate inventory path: ${url}`);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid SHA-256: ${url}`);
    seen.add(url); return [url, digest];
  }).sort((a,b) => Buffer.compare(Buffer.from(a[0], 'utf8'), Buffer.from(b[0], 'utf8')));
  // UTF-8 JSON array of [absolute ASCII URL path, lowercase SHA-256] pairs,
  // no BOM, whitespace or trailing newline. MIME/size/diagnostics excluded.
  return Buffer.from(JSON.stringify(pairs), 'utf8');
}
async function finalizeRelease(root, dist = path.join(root,'dist')) {
  const assetMap = {};
  async function hashed(source, bytes = null) {
    bytes = bytes || await fs.readFile(path.join(dist,source));
    const ext = path.extname(source);
    const target = `${source.slice(0,-ext.length)}.${sha256(bytes)}${ext}`;
    await fs.writeFile(path.join(dist,target),bytes);
    await fs.unlink(path.join(dist,source));
    assetMap[source] = target;
    return target;
  }
  const fonts = (await fs.readdir(path.join(dist,'assets/fonts/open-sans'))).filter(n=>n.endsWith('.woff2')).sort();
  const icons = (await fs.readdir(path.join(dist,'assets/icons'))).filter(n=>n.endsWith('.png') && n !== 'master-733.png').sort();
  for (const name of fonts) await hashed(`assets/fonts/open-sans/${name}`);
  for (const name of icons) await hashed(`assets/icons/${name}`);
  await hashed('favicon-64x64.png');
  await hashed('bundle.js');
  let css = await fs.readFile(path.join(dist,'app/layout.css'),'utf8');
  for (const [source,target] of Object.entries(assetMap)) {
    css = css.split(path.posix.relative('app',source)).join(path.posix.relative('app',target));
  }
  await hashed('app/layout.css',Buffer.from(css));
  const manifest = JSON.parse(await fs.readFile(path.join(dist,'manifest.webmanifest'),'utf8'));
  for (const icon of manifest.icons) {
    if (!assetMap[icon.src]) throw new Error(`Unknown manifest icon: ${icon.src}`);
    icon.src = assetMap[icon.src];
  }
  await hashed('manifest.webmanifest',Buffer.from(JSON.stringify(manifest)));
  let html = await fs.readFile(path.join(dist,'index.html'),'utf8');
  for (const [source,target] of Object.entries(assetMap)) html = html.split(source).join(target);
  // Bind the loaded HTML and all rewritten asset references without a circular
  // releaseId-in-HTML hash. The token is hashed into the final inventory HTML.
  const shellId = sha256(Buffer.from(html));
  html = html.replace('</head>', `<meta name="fluid-shell-id" content="${shellId}"></head>`);
  await fs.writeFile(path.join(dist,'index.html'),html);
  // Non-runtime authoring master and scratch registry never ship in production.
  await fs.rm(path.join(dist,'assets/icons/master-733.png'),{force:true});
  await fs.rm(path.join(dist,'.build'),{recursive:true,force:true});
  const entries = [];
  for (const file of ['index.html',...Object.values(assetMap)]) {
    const bytes = await fs.readFile(path.join(dist,file));
    entries.push({path:`/${file}`,sha256:sha256(bytes),size:bytes.length});
  }
  entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  const releaseId = sha256(canonicalInventory(entries));
  const inventory = {schemaVersion:1,releaseId,shellId,canonicalEncoding:'utf8-json-path-sha256-pairs-v1',entries};
  await fs.writeFile(path.join(dist,'precache-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
  let gitSha = null;
  try { gitSha = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(); } catch { /* diagnostics may be unavailable in source archives */ }
  await fs.writeFile(path.join(dist,'release.json'),JSON.stringify({schemaVersion:1,releaseId,gitSha,buildTime:new Date().toISOString(),assetMap},null,2)+'\n');
  // Netlify path patterns are not regexes. Emit exact hash paths rather than
  // a wildcard that could give fixed/non-hashed files a year-long lifetime.
  await fs.writeFile(path.join(dist,'_headers'),Object.values(assetMap).map(file =>
    `/${file}\n  Cache-Control: public, max-age=31536000, immutable\n`).join('\n'));
  const worker = require(path.join(root, 'app/pwa-worker.js')).fluidPwaWorker;
  await fs.writeFile(path.join(dist,'sw.js'),`'use strict';\n(${worker.toString()})(${JSON.stringify(inventory)});\n`);
  return inventory;
}
module.exports = {sha256,canonicalInventory,finalizeRelease};
