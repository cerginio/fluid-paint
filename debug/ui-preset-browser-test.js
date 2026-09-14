'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Fluid UI preset');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain' };
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
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const base = `http://127.0.0.1:${server.address().port}/index.html?debug=none`;

    await page.goto(base);
    await page.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    assert.equal(await page.locator('#ui').isVisible(), true, 'full is the default');
    assert.deepEqual(await page.evaluate(() => window.__fluidUiPresetApi.getResolvedFeatures()), [
      'color-picker', 'brush-size', 'colors-options', 'brush-options', 'player', 'file-bg', 'file-play', 'state-bake',
    ]);
    assert.equal(await page.evaluate(() => window.__painter.setPaintSize(999)), 112.5,
      'host API reaches 50% beyond the built-in 75px brush maximum');
    await page.evaluate(() => window.__painter.setPaintSize(50));
    const pngOnlyState = await page.evaluate(async () => {
      const source = document.createElement('canvas');
      source.width = 2;
      source.height = 2;
      await window.__painter.storyPlaybackController.loadScene({
        background: { source, summary: { fileName: 'reference.png', transferId: 'png-only' } },
        transferId: 'png-only',
      });
      const controller = window.__painter.storyPlaybackController;
      return { state: controller.state, hasModel: !!controller.model, background: controller.backgroundSummary.fileName };
    });
    assert.deepEqual(pngOnlyState, { state: 'ready', hasModel: false, background: 'reference.png' },
      'Fluid Rescript accepts a PNG-only transferred scene');

    await page.goto(`${base}&uiMode=empty`);
    await page.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    assert.equal(await page.locator('#ui').isVisible(), false, 'empty hides Fluid chrome');
    assert.equal(await page.locator('#canvas-cell canvas').isVisible(), true, 'empty preserves the canvas');
    assert.equal(await page.locator('#debug-toggle-tr').isVisible(), false, 'empty hides debug controls');
    assert.equal(await page.locator('#debug-toggle-br').isVisible(), false, 'empty hides texture-probe controls');
    assert.equal(await page.locator('#footer').isVisible(), false, 'empty hides standalone footer chrome');
    assert.deepEqual(await page.evaluate(() => ({
      brushViewer: window.__painter.brushViewer,
      paintingRectOverlay: window.__painter.paintingRectOverlay,
      debugToggles: window.__painter.debugToggles,
      textureProbe: window.__textureProbe.isOn(),
    })), { brushViewer: null, paintingRectOverlay: null, debugToggles: null, textureProbe: false },
    'restricted UI does not allocate debug facilities');

    await page.goto(`${base}&uiMode=preset&uiPreset=draw-min`);
    await page.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    assert.equal(await page.locator('#ui').isVisible(), true);
    assert.equal(await page.locator('#bar-size-slider').isVisible(), true);
    assert.equal(await page.locator('#bar-hue-stripe').isVisible(), true);
    assert.equal(await page.locator('#panel-extension-toggle').isVisible(), false);
    assert.equal(await page.locator('#fluidity-slider').isVisible(), false);

    await page.goto(`${base}&uiMode=preset&uiPreset=draw-min&uiFeatures=brush-options,state-bake`);
    await page.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    assert.deepEqual(await page.evaluate(() => window.__fluidUiPresetApi.getResolvedFeatures()), [
      'color-picker', 'brush-size', 'brush-options', 'state-bake',
    ]);
    assert.equal(await page.locator('#panel-extension-toggle').isVisible(), true);
    await page.click('#panel-grip');
    assert.equal(await page.locator('#fluidity-slider').isVisible(), true,
      'brush-options exposes Paint Fluidity in the panel');
    assert.equal(await page.locator('#bristles-slider').isVisible(), true,
      'brush-options exposes Bristle Count in the panel');
    assert.equal(await page.locator('#bristle-shapes').isVisible(), true,
      'brush-options exposes Bristle Shape in the panel');
    assert.deepEqual(
      await page.locator('#bristle-shapes div').allTextContents(),
      ['Round', 'Tri', 'Quad', 'Pent', 'Hex']);
    assert.equal(
      await page.locator('#bristle-shapes .button-selected').textContent(), 'Round',
      'the round default is selected on load');
    assert.equal(await page.evaluate(() => window.__painter.brushShape), null,
      'and Round means no footprint at all, not a 0-sided one');

    // The control must actually reach the stroke: select Hex, then confirm the
    // footprint the engine is handed. A control that only moved its highlight
    // would pass every visibility check above.
    const strokeShape = await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll('#bristle-shapes div')];
      buttons.find((button) => button.textContent === 'Hex')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const painter = window.__painter;
      const seen = [];
      const original = painter.engine.beginStroke.bind(painter.engine);
      painter.engine.beginStroke = (options) => { seen.push(options.brushShape); return original(options); };
      painter.update = () => {};
      if (painter.engine.strokeActive) painter.engine.endStroke();
      painter.brushX = painter.paintingRectangle.left + 100;
      painter.brushY = painter.paintingRectangle.bottom + 100;
      painter._beginPaintStroke(1, 'mouse');
      painter.engine.endStroke();
      painter.engine.beginStroke = original;
      return { state: painter.brushShape, passedToEngine: seen };
    });
    assert.deepEqual(strokeShape.state, { sides: 6 });
    assert.deepEqual(strokeShape.passedToEngine, [{ sides: 6 }],
      'the selected footprint reaches beginStroke()');

    await page.goto(`${base}&uiMode=preset&uiPreset=draw-min`);
    await page.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    await page.evaluate(() => { window.__presetTestCanvas = document.querySelector('#canvas-cell canvas'); });
    await page.evaluate(() => window.__fluidUiPresetApi.configure({ mode: 'features', features: ['player'] }));
    assert.equal(await page.locator('#panel-extension-toggle').isVisible(), true);
    assert.equal(await page.locator('#bar-size-slider').isVisible(), false);
    await page.click('#panel-extension-toggle');
    assert.equal(await page.locator('#story-player-page').isVisible(), true);
    assert.equal(await page.locator('#panel-extension').evaluate((element) => element.inert), false);
    assert.equal(await page.evaluate(() => document.querySelector('#canvas-cell canvas') === window.__presetTestCanvas), true,
      'runtime layout changes preserve the rendering canvas');

    console.log('Fluid UI preset browser: PASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
