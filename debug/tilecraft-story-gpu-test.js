'use strict';

// Starts the supplied Tilecraft fixture through the actual browser engine.
// Full live playback is intentionally not awaited here: the production fixture
// has tens of thousands of points and the unit test already verifies complete
// traversal. This test proves the browser URL wiring reaches a live stroke.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Tilecraft story replay');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
  '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none&diag=0&story=1&storySpeed=8`);
    await page.waitForFunction(() => window.__tilecraftStoryStarted && window.__tilecraftStoryPlayer);
    await page.waitForTimeout(100);
    const result = await page.evaluate(() => ({
      active: window.__painter.engine.strokeActive,
      glError: window.__painter.wgl.gl.getError(),
    }));
    assert.deepEqual(errors, []);
    assert.equal(result.active, true);
    assert.equal(result.glError, 0);
    console.log(JSON.stringify({ story: 'story-2026-09-08-4-frames.json', ...result }));
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
