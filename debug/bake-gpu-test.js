'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Bake GPU check');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.vert': 'text/plain', '.frag': 'text/plain' };
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
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none&seed=7`);
    await page.waitForFunction(() => window.__painter && window.__painter.engine);

    const result = await page.evaluate(async () => {
      const painter = window.__painter;
      const engine = painter.engine;
      const rect = painter.paintingRectangle;
      const x = rect.left + rect.width * 0.5;
      const y = rect.bottom + rect.height * 0.5;
      engine.beginStroke({ timing: 'live', x, y, brushSize: 55,
        paintingRectangle: rect, color: { space: 'pigment', channels: [1, 0, 0], alpha: 0.8 } });
      engine.endStroke();
      painter.saveSnapshot();

      const renderedBefore = engine.exportPixels({ width: Math.round(rect.width),
        height: Math.round(rect.height), resolutionScale: painter.resolutionScale,
        colorModel: painter.colorModel });
      painter.toolPanel.setExtensionOpen(true);
      painter.toolPanel.selectExtensionTab('bake');
      const bakeTabSelected = document.getElementById('bake-tab').getAttribute('aria-selected');
      const bakePageVisible = !document.getElementById('bake-page').hidden;
      document.getElementById('bake-button').click();
      await new Promise((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
          if (!document.getElementById('bake-button').disabled && engine.renderer.hasBackground) resolve();
          else if (performance.now() - started > 5000) reject(new Error('Bake timed out'));
          else requestAnimationFrame(poll);
        };
        poll();
      });
      const renderedAfter = engine.exportPixels({ width: Math.round(rect.width),
        height: Math.round(rect.height), resolutionScale: painter.resolutionScale,
        colorModel: painter.colorModel });
      const material = engine.readPaintTexture().pixels;
      let materialMagnitude = 0;
      for (const value of material) materialMagnitude += Math.abs(value);
      let maxRenderedDelta = 0;
      for (let i = 0; i < renderedBefore.length; i++) {
        maxRenderedDelta = Math.max(maxRenderedDelta, Math.abs(renderedBefore[i] - renderedAfter[i]));
      }
      return {
        materialMagnitude,
        maxRenderedDelta,
        splatAreas: engine.simulator.splatAreas.length,
        canUndo: painter.canUndo(),
        canRedo: painter.canRedo(),
        hasBackground: engine.renderer.hasBackground,
        summary: painter.storyPlaybackController.backgroundSummary,
        bakeTabSelected,
        bakePageVisible,
        status: document.getElementById('bake-status').textContent,
        glError: painter.wgl.gl.getError(),
      };
    });

    assert.deepEqual(errors, []);
    assert.equal(result.materialMagnitude, 0);
    assert.equal(result.splatAreas, 0);
    assert.equal(result.canUndo, false);
    assert.equal(result.canRedo, false);
    assert.equal(result.hasBackground, true);
    assert.equal(result.summary.fileName, 'Baked artwork');
    assert.equal(result.bakeTabSelected, 'true');
    assert.equal(result.bakePageVisible, true);
    assert.match(result.status, /Baked/);
    assert.ok(result.maxRenderedDelta <= 1, `bake changed rendered pixels by ${result.maxRenderedDelta}`);
    assert.equal(result.glError, 0);
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
