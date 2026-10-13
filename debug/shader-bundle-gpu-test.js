'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { makeShaderRegistry } = require('./shader-bundle-build');
require('./browser-lock').acquireBrowserLock('fluid-2 C shader bundle');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fluid-2-C-'));
const result = { output, backend: 'Chromium ANGLE SwiftShader (not physical GPU)', cases: [], cleanup: [] };
const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.frag': 'text/plain', '.vert': 'text/plain', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await fn()) return; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function bindBack(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve)); result.cleanup.push({ port, bindBack: true });
}
async function draw(page, minimal = false) {
  return page.evaluate((minimal) => {
    const host = minimal ? window.__minimalHost : window.__painter;
    const engine = host.engine, rect = host.paintingRectangle;
    const before = engine.readPaintTexture().pixels;
    engine.beginStroke({ timing: 'live', x: rect.left + rect.width * .5, y: rect.bottom + rect.height * .5,
      brushSize: 42, paintingRectangle: rect, color: minimal ? { space: 'pigment', channels: [.2, .8, .4], alpha: .8 } : host._strokeColor(),
      resolutionScale: minimal ? RESOLUTION_SCALE : host.getEffectiveResolutionScale() });
    engine.endStroke();
    const after = engine.readPaintTexture().pixels;
    let materialDelta = 0;
    for (let i = 0; i < before.length; i++) materialDelta = Math.max(materialDelta, Math.abs(before[i] - after[i]));
    host.needsRedraw = true;
    if (!minimal) host.update();
    return { materialDelta, webglVersion: engine.capabilities.webglVersion };
  }, minimal);
}
async function main() {
  let browser, dev, devPort;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; result.port = port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const buildLog = execFileSync(process.execPath, [path.join(root, 'node_modules/gulp/bin/gulp.js'), 'build'],
      { cwd: root, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
    fs.writeFileSync(path.join(output, 'production-build.log'), buildLog);
    const expectedRegistry = await makeShaderRegistry(root);
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'] });
    for (const version of [1, 2]) {
      const page = await browser.newPage({ viewport: { width: 960, height: 720 }, acceptDownloads: true });
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.route(/\.(?:frag|vert)(?:\?|$)/, route => { requests.push(route.request().url()); return route.abort(); });
      const url = `${base}/dist/index.html?webgl=${version}&debug=none&diag=0&seed=41`;
      await page.goto(url); await page.waitForFunction(() => window.__painter?.engine?.capabilities?.canDepositPaint);
      const bundledRegistry = await page.evaluate(() => globalThis.FLUID_SHADER_SOURCES);
      assert.deepEqual(bundledRegistry, { ...expectedRegistry });
      // Bound GPU allocations as in the existing phase B harness.
      await page.evaluate(() => {
        const p = window.__painter; p.paintingRectangle.width = 180; p.paintingRectangle.height = 130;
        p.engine.resizePainting(p.getPaintingResolutionWidth(), p.getPaintingResolutionHeight(), 0, 0);
        p.setPaintColor('#3B82F6');
      });
      const drawn = await draw(page); assert.equal(drawn.webglVersion, version); assert.ok(drawn.materialDelta > 0);
      await page.screenshot({ path: path.join(output, `bundle-webgl${version}-screen.png`) });
      const resized = await page.evaluate(() => {
        const p = window.__painter;
        p.newPaintingRectangle = p.paintingRectangle.clone(); p.newPaintingRectangle.width += 16; p.newPaintingRectangle.height += 12;
        p.resizingSide = ResizingSide.TOP_RIGHT;
        p.interactionState = InteractionMode.RESIZING; p.needsRedraw = true; p.update();
        const glErrorPreview = p.wgl.gl.getError();
        p.interactionState = InteractionMode.NONE; p._commitResize(); p.needsRedraw = true; p.update();
        return { glErrorPreview, glErrorCommitted: p.wgl.gl.getError(), width: p.paintingRectangle.width, height: p.paintingRectangle.height };
      });
      assert.equal(resized.glErrorPreview, 0); assert.equal(resized.glErrorCommitted, 0);
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.screenshot({ path: path.join(output, `bundle-webgl${version}-resize.png`) });
      await page.locator('#panel-grip').click();
      const [download] = await Promise.all([
        page.waitForEvent('download'), page.locator('#save-button').click(),
      ]);
      const png = path.join(output, `bundle-webgl${version}-save.png`); await download.saveAs(png);
      const bytes = fs.readFileSync(png); assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.length > 100);
      assert.equal(requests.length, 0); assert.deepEqual(errors, []);
      result.cases.push({ name: `bundle-WebGL${version}`, url, ...drawn, resized, shaderRequests: requests.length, errors, savedPng: png, pngBytes: bytes.length,
        registryKeys: Object.keys(bundledRegistry).length, manifestEqual: true, shaderTextExact: true });
      await page.close();
    }
    for (const minimal of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
      const requests = [], errors = [];
      page.on('request', r => { if (/\.(frag|vert)(?:\?|$)/.test(r.url())) requests.push(r.url()); });
      page.on('pageerror', e => errors.push(e.message));
      const url = `${base}/${minimal ? 'examples/minimal/index.html' : 'index.html'}?debug=none&diag=0&seed=41`;
      await page.goto(url); await page.waitForFunction(m => !!(m ? window.__minimalHost : window.__painter)?.engine, minimal);
      const drawn = await draw(page, minimal); assert.ok(drawn.materialDelta > 0); assert.ok(requests.length > 0); assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, minimal ? 'source-minimal.png' : 'source-paint.png') });
      result.cases.push({ name: minimal ? 'source-minimal' : 'source-paint', url, ...drawn, shaderRequests: requests.length, errors });
      await page.close();
    }
    for (const kind of ['registry', 'http404', 'network', 'html200', 'minimal404']) {
      const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
      const requests = [], pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      page.on('request', r => { if (/\.(frag|vert)(?:\?|$)/.test(r.url())) requests.push(r.url()); });
      if (kind === 'registry') {
        await page.addInitScript(() => {
          let registry;
          Object.defineProperty(globalThis, 'FLUID_SHADER_SOURCES', {
            configurable: true,
            get: () => registry,
            set: value => { registry = value; delete registry['fluid-engine/shaders/splat.vert']; },
          });
        });
      } else {
        await page.route('**/fluid-engine/shaders/splat.vert', route => kind === 'network' ? route.abort('failed') :
          route.fulfill({ status: kind === 'html200' ? 200 : 404, contentType: 'text/html', body: '<!doctype html><html>controlled failure</html>' }));
      }
      const minimal = kind === 'minimal404';
      const url = `${base}/${kind === 'registry' ? 'dist/index.html' : minimal ? 'examples/minimal/index.html' : 'index.html'}?debug=none&diag=0`;
      await page.goto(url);
      const selector = minimal ? '#status' : '#shader-load-error';
      await page.waitForFunction(sel => document.querySelector(sel)?.textContent?.includes('splat.vert'), selector);
      const message = await page.locator(selector).textContent(); assert.match(message, /splat.vert/);
      if (kind === 'registry') assert.equal(requests.length, 0);
      assert.deepEqual(pageErrors, []);
      assert.equal(await page.evaluate(m => !!(m ? window.__minimalHost : window.__painter)?.engine, minimal), false);
      await page.screenshot({ path: path.join(output, `error-${kind}.png`) });
      result.cases.push({ name: `error-${kind}`, url, message, shaderRequests: requests.length, pageErrors }); await page.close();
    }
    // Exercise the actual gulp dev watcher, not a mock regeneration helper.
    const devLog = path.join(output, 'dev-watch.log');
    dev = spawn(process.execPath, [path.join(root, 'node_modules/gulp/bin/gulp.js'), 'serve'],
      { cwd: root, env: { ...process.env, NODE_ENV: 'development', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const collect = data => { log += data.toString(); fs.appendFileSync(devLog, data); };
    dev.stdout.on('data', collect); dev.stderr.on('data', collect);
    await until(() => { const match = log.match(/Development server running at http:\/\/127.0.0.1:(\d+)/); if (match) devPort = Number(match[1]); return !!devPort; }, 'dev startup');
    const devBundlePath = path.join(root, 'dist/bundle.js');
    const originalDevBundle = fs.readFileSync(devBundlePath);
    const shader = path.join(root, 'app/shaders/shadow.frag'), original = fs.readFileSync(shader);
    const marker = `phase-C-watch-${Date.now()}`;
    try {
      fs.appendFileSync(shader, `\n// ${marker}\n`);
      await until(() => fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8').includes(marker), 'shader rebuild');
      result.shaderWatch = { marker, bundleContainsMarker: true };
    } finally { fs.writeFileSync(shader, original); }
    await until(() => fs.readFileSync(devBundlePath).equals(originalDevBundle), 'complete shader restore rebuild');
    // Wait for the stream write/task and chokidar's atomic-write window to
    // settle before the independent manifest edit (absence during truncation
    // alone is not proof of a completed restored bundle).
    await sleep(1000);
    const manifest = path.join(root, 'common.js'), originalManifest = fs.readFileSync(manifest);
    try {
      fs.writeFileSync(manifest, originalManifest.toString().replace("const APP_SHADERS = [", "const APP_SHADERS = [\n  'shaders/picker.vert',"));
      await until(() => fs.readFileSync(path.join(root, 'dist/.build/shader-registry.js'), 'utf8').includes('app/shaders/picker.vert'), 'manifest registry rebuild');
      await until(() => fs.readFileSync(path.join(root, 'dist/bundle.js'), 'utf8').includes('app/shaders/picker.vert'), 'manifest rebuild');
      result.manifestWatch = { addedPhysicalKey: 'app/shaders/picker.vert', bundleContainsKey: true };
    } finally { fs.writeFileSync(manifest, originalManifest); }
    await until(() => fs.readFileSync(devBundlePath).equals(originalDevBundle), 'complete manifest restore rebuild');
    result.devRestoreBundleExact = true;
    await sleep(1000);
    const devPage = await browser.newPage(); let devRequests = 0;
    await devPage.route(/\.(?:frag|vert)(?:\?|$)/, route => { devRequests++; return route.abort(); });
    await devPage.goto(`http://127.0.0.1:${devPort}/index.html?debug=none&diag=0&seed=41`);
    await devPage.waitForFunction(() => !!window.__painter?.engine);
    const devDraw = await draw(devPage); assert.ok(devDraw.materialDelta > 0); assert.equal(devRequests, 0);
    await devPage.screenshot({ path: path.join(output, 'dev-bundle.png') }); await devPage.close();
    result.dev = { port: devPort, shaderRequests: devRequests, ...devDraw };
    result.pass = true;
  } catch (error) { result.pass = false; result.error = error.stack; process.exitCode = 1; }
  finally {
    if (browser) await browser.close();
    if (dev && dev.exitCode === null) {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(dev.pid), '/T', '/F']);
      else dev.kill('SIGTERM');
      await until(() => dev.exitCode !== null || dev.signalCode !== null, 'dev exit');
    }
    if (devPort) await bindBack(devPort);
    await new Promise(resolve => server.close(resolve)); await bindBack(port);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
