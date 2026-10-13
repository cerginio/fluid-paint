'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('fluid-2 phase A color adapter GPU');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fluid-2-A-'));
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.vert': 'text/plain', '.frag': 'text/plain' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});
(async () => {
  await new Promise((resolve) => server.listen(Number(process.env.COLOR_PROBE_PORT || 0), '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  const results = [];
  const metadata = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirtyScope: execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }),
    command: 'npm run test:color-adapter:gpu', at: new Date().toISOString(),
    backend: 'Chromium ANGLE SwiftShader; iphone-14 is capability clamp, not physical device', output, port };
  try {
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--renderer-process-limit=1'] });
    for (const webgl of [2, 1]) for (const gpu of ['desktop', 'iphone-14']) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
      const errors = [];
      const consoleErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      const url = `http://127.0.0.1:${port}/debug/paint-color-adapter-probe.html?webgl=${webgl}&gpu=${gpu}`;
      await page.goto(url);
      await page.waitForFunction(() => window.__colorProbe || window.__probeResult);
      await page.getByRole('button', { name: 'Запустити перевірку' }).click();
      const result = await page.evaluate(() => window.__probeResult);
      fs.writeFileSync(path.join(output, `${webgl}-${gpu}.json`), JSON.stringify({ url, errors, consoleErrors, result }, null, 2));
      await page.screenshot({ path: path.join(output, `${webgl}-${gpu}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.equal(result.pass, true, JSON.stringify(result));
      assert.equal(result.webgl, webgl);
      assert.equal(result.precision, gpu === 'desktop' ? 'float' : 'half-float');
      assert.equal(result.decode.length, 17);
      assert.equal(result.comparisons.length, 3);
      assert.ok(result.rendererNegativeControlDelta > 1);
      assert.ok(result.comparisons.every((row) => row.steps === 30));
      const before = await page.evaluate(() => Array.from(window.__colorProbe.exportPixels()));
      await page.getByLabel('Палітра').selectOption('digital');
      const after = await page.evaluate(() => Array.from(window.__colorProbe.exportPixels()));
      assert.deepEqual(after, before);
      results.push({ webgl, gpu, precision: result.precision,
        worstDecodeDelta: Math.max(...result.decode.map((row) => row.maxDelta)), comparisons: result.comparisons });
      await page.close();
    }
    for (const entry of ['index.html', 'dist/index.html']) {
      const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
      const errors = [];
      const consoleErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/${entry}?debug=none&seed=7`);
      await page.waitForFunction(() => window.__painter?.engine);
      const smoke = await page.evaluate(() => ({ adapter: typeof PaintColorAdapter,
        canDeposit: window.__painter.engine.capabilities.canDepositPaint,
        colorModel: window.__painter.colorModel, glError: window.__painter.wgl.gl.getError() }));
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.equal(smoke.adapter, 'object'); assert.equal(smoke.canDeposit, true);
      assert.equal(smoke.colorModel, 0); assert.equal(smoke.glError, 0);
      await page.screenshot({ path: path.join(output, entry.startsWith('dist') ? 'production.png' : 'source.png') });
      results.push({ entry, smoke });
      await page.close();
    }
    metadata.exitCode = 0;
    console.log(JSON.stringify({ ...metadata, results }, null, 2));
  } catch (error) {
    metadata.exitCode = 1; metadata.error = error.stack; throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve, reject) => {
      const check = require('node:net').createServer();
      check.once('error', reject);
      check.listen(port, '127.0.0.1', () => check.close(resolve));
    });
    metadata.portReleased = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...metadata, results }, null, 2));
    console.log('Evidence: ' + output);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
