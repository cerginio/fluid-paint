'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const origin = 'https://fluid.storytilecraft.space';
const read = (name) => fs.readFileSync(path.join(dist, name), 'utf8');
const map = JSON.parse(read('release.json')).assetMap;
const built = (source) => map[source] || source;
const sourceOf = (output) => Object.keys(map).find(key => map[key] === output) || output;
const manifest = () => JSON.parse(read(built('manifest.webmanifest')));
function local(value, base = `${origin}/index.html`) {
  assert.ok(value && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value), `Nonlocal reference: ${value}`);
  const url = new URL(value, base);
  assert.equal(url.origin, origin);
  assert.ok(!url.search && !url.hash, `Unexpected query/hash: ${value}`);
  return path.join(dist, decodeURIComponent(url.pathname));
}
function png(file, size) {
  const bytes = fs.readFileSync(file);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(bytes.toString('ascii',12,16), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), size);
  assert.equal(bytes.readUInt32BE(20), size);
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
test('all built HTML/CSS/manifest references are local and resolve', () => {
  for (const file of files(dist)) {
    const ext = path.extname(file);
    if (!['.html','.css','.webmanifest'].includes(ext)) continue;
    const text = fs.readFileSync(file,'utf8');
    assert.doesNotMatch(text, /fonts\.(?:googleapis|gstatic)\.com/);
    const base = `${origin}/${path.relative(dist,file).replaceAll('\\','/')}`;
    let refs = [];
    if (ext === '.html') {
      for (const tag of text.matchAll(/<[a-z][^>]*>/gi)) {
        refs.push(...Array.from(tag[0].matchAll(/\b(?:src|href|action|poster)\s*=\s*["']([^"']+)["']/gi), (m) => m[1]));
        assert.doesNotMatch(tag[0], /\bsrcset\s*=/i, 'Add srcset parsing before using srcset');
      }
    } else if (ext === '.css') {
      refs = Array.from(text.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/gi), (m) => m[1]);
      refs.push(...Array.from(text.matchAll(/@import\s+["']([^"']+)["']/gi), (m) => m[1]));
    } else {
      const walk = (v,k) => { if (v && typeof v === 'object') Object.entries(v).forEach(([key,val]) => walk(val,key));
        else if (['src','url','id','scope','start_url'].includes(k)) refs.push(v); };
      walk(JSON.parse(text));
    }
    for (const ref of refs) {
      const target = local(ref,base);
      assert.ok(fs.existsSync(target), `${file}: missing ${ref}`);
    }
  }
});
test('manifest has stable Fluid Paint identity and clean scoped standalone launch', () => {
  const m = manifest();
  assert.equal(m.id, '/'); assert.equal(m.name, 'Fluid Paint'); assert.equal(m.short_name, 'Fluid Paint');
  assert.equal(m.scope, '/'); assert.equal(m.start_url, '/'); assert.equal(m.display, 'standalone');
  for (const key of ['background_color','theme_color']) assert.match(m[key], /^#[0-9a-f]{6}$/i);
  assert.ok(m.description); assert.equal(m.related_applications, undefined);
  assert.equal(m.shortcuts, undefined);
});
test('any and maskable icons are true 192/512 PNGs copied byte-for-byte', () => {
  const icons = manifest().icons;
  assert.equal(icons.length,4);
  for (const purpose of ['any','maskable']) for (const size of [192,512]) {
    const icon = icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
    assert.ok(icon); assert.equal(icon.type, 'image/png');
    const file = local(icon.src); png(file,size);
    assert.deepEqual(fs.readFileSync(file),fs.readFileSync(path.join(root,sourceOf(icon.src))));
  }
});
test('HTML links manifest, theme color, true favicon and 180px apple touch icon', () => {
  const html = read('index.html');
  assert.ok(html.includes(`href="${built('manifest.webmanifest')}"`));
  assert.match(html, /<meta[^>]*name="theme-color"[^>]*content="#202024"/);
  assert.match(html, /<link[^>]*rel="apple-touch-icon"[^>]*sizes="180x180"/);
  assert.ok(html.includes(`href="${built('assets/icons/apple-touch-icon.png')}"`));
  png(local(built('assets/icons/apple-touch-icon.png')),180); png(local(built('favicon-64x64.png')),64);
});
test('Open Sans 400/600/700 normal use local valid woff2, swap and valid subset ranges', () => {
  const css = postcss.parse(read(built('app/layout.css')));
  const faces = [];
  css.walkAtRules('font-face', (rule) => {
    const d = {}; rule.walkDecls((decl) => { d[decl.prop] = decl.value; }); faces.push(d);
  });
  assert.equal(faces.length,9);
  for (const weight of [400,600,700]) {
    const subsetFaces = faces.filter((face) => face['font-weight'] === String(weight));
    assert.equal(subsetFaces.length,3);
    for (const face of subsetFaces) {
      assert.equal(face['font-family'].replaceAll(/["']/g,''),'Open Sans');
      assert.equal(face['font-display'],'swap'); assert.equal(face['font-style'],'normal');
      const ref = face.src.match(/url\(["']?([^)'" ]+)/)[1];
      const file = local(ref, `${origin}/app/layout.css`);
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.toString('ascii',0,4),'wOF2'); assert.equal(bytes.readUInt32BE(8),bytes.length);
      assert.deepEqual(bytes,fs.readFileSync(path.join(root,sourceOf(path.relative(dist,file).replaceAll('\\','/')))));
      for (const range of face['unicode-range'].split(',')) {
        const match = range.match(/^U\+([\dA-F]+)(?:-([\dA-F]+)|\?+)?$/i); assert.ok(match);
        if (match[2]) assert.ok(parseInt(match[1],16)<=parseInt(match[2],16));
      }
    }
    assert.ok(subsetFaces.some((face) => /u\+0400-045f/i.test(face['unicode-range'])));
  }
  assert.match(read('assets/fonts/open-sans/LICENSE'), /SIL OPEN FONT LICENSE Version 1.1/);
});
test('master remains the directed 733px source, not an upscaled favicon', () => {
  png(path.join(root,'assets/icons/master-733.png'),733);
  const { createHash } = require('node:crypto');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'assets/icons/master-733.png'))).digest('hex'),
    '725ac9836dd734c49a7753777316cc273a5bfc50a8f632ddc61c2baf937b9003');
});
test('phases 1-2 do not register or ship a service worker', () => {
  assert.ok(!fs.existsSync(path.join(dist,'sw.js')));
  assert.doesNotMatch(read(built('bundle.js'))+read('index.html'), /serviceWorker\s*\.\s*register\s*\(/);
});
