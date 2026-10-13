'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('fluid-2 phase B Paint palette GPU');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fluid-2-B-'));
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.vert': 'text/plain', '.frag': 'text/plain', '.png': 'image/png' };
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

function maxDelta(a, b) {
  assert.equal(a.length, b.length);
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta = Math.max(delta, Math.abs(a[i] - b[i]));
  return delta;
}

async function makePage(browser, port, tag) {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?debug=none&diag=0&seed=41`);
  await page.waitForFunction(() => window.__painter?.engine?.capabilities?.canDepositPaint);
  await page.evaluate(() => {
    const painter = window.__painter;
    painter.paintingRectangle.width = 180;
    painter.paintingRectangle.height = 130;
    painter.engine.resizePainting(
      painter.getPaintingResolutionWidth(),
      painter.getPaintingResolutionHeight(),
      0,
      0
    );
    painter.needsRedraw = true;
  });
  return { page, errors, consoleErrors, tag };
}

async function paintProgrammatic(page, { mode = 'natural', color = '#3B82F6', x = .5, y = .5, size = 42 } = {}) {
  return page.evaluate(({ mode, color, x, y, size }) => {
    const painter = window.__painter;
    const rect = painter.paintingRectangle;
    painter.setPaletteMode(mode);
    painter.setPaintColor(color);
    painter.engine.beginStroke({
      timing: 'live',
      x: rect.left + rect.width * x,
      y: rect.bottom + rect.height * y,
      brushSize: size,
      paintingRectangle: rect,
      color: painter._strokeColor(),
      resolutionScale: painter.getEffectiveResolutionScale(),
    });
    painter.engine.endStroke();
    painter.needsRedraw = true;
    return {
      mode: painter.paletteMode,
      colorModel: painter.colorModel,
      exact: painter.exactPaintRgb && painter.exactPaintRgb.slice(),
      strokeColor: painter._strokeColor(),
      hex: document.getElementById('paint-color-hex')?.textContent,
    };
  }, { mode, color, x, y, size });
}

async function exportState(page) {
  return page.evaluate(() => {
    const painter = window.__painter;
    const rect = painter.paintingRectangle;
    return {
      pixels: Array.from(painter.engine.exportPixels({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        resolutionScale: painter.resolutionScale,
        colorModel: FluidEngine.COLOR_MODEL.RGB,
      })),
      raw: Array.from(painter.engine.readPaintTexture().pixels),
    };
  });
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  const results = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirtyScope: execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }),
    command: 'npm run test:paint-palette:gpu',
    backend: 'Chromium ANGLE SwiftShader; not physical GPU coverage',
    output,
    port,
  };
  try {
    browser = await chromium.launch({ args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
    ] });

    const first = await makePage(browser, port, 'frozen');
    const firstPaint = await paintProgrammatic(first.page, { mode: 'natural', color: '#3B82F6', x: .42, y: .55 });
    assert.equal(firstPaint.colorModel, 1, 'Paint renders through fixed RGB model');
    assert.equal(firstPaint.hex, '#3B82F6');
    const frozenBefore = await exportState(first.page);
    await first.page.evaluate(() => {
      window.__painter.setPaletteMode('digital');
      window.__painter.setPaletteMode('natural');
    });
    const frozenAfter = await exportState(first.page);
    results.frozen = {
      rawDelta: maxDelta(frozenBefore.raw, frozenAfter.raw),
      exportDelta: maxDelta(frozenBefore.pixels, frozenAfter.pixels),
    };
    assert.equal(results.frozen.rawDelta, 0);
    assert.equal(results.frozen.exportDelta, 0);

    const endpoints = await first.page.evaluate(() => {
      const painter = window.__painter;
      painter.setPaintColor('#123456');
      painter.setPaletteMode('digital');
      const afterSwitch = painter._strokeColor();
      painter.colorControl.picker.color.alpha = 0.25;
      const afterAlpha = painter._strokeColor();
      painter.setPaintColor('white');
      const white = painter._strokeColor();
      painter.setPaintColor('black');
      const black = painter._strokeColor();
      return {
        afterSwitch,
        afterAlpha,
        white,
        black,
        hex: document.getElementById('paint-color-hex').textContent,
        alpha: document.getElementById('paint-color-alpha').textContent,
      };
    });
    assert.deepEqual(endpoints.afterSwitch.channels, [1 - 0x34 / 255, 1 - 0x12 / 255, 1 - 0x56 / 255]);
    assert.deepEqual(endpoints.afterAlpha.channels, endpoints.afterSwitch.channels);
    assert.deepEqual(endpoints.white.channels, [0, 0, 0]);
    assert.deepEqual(endpoints.black.channels, [1, 1, 1]);
    results.endpoints = endpoints;

    results.history = await first.page.evaluate(async () => {
      const painter = window.__painter;
      const before = Array.from(painter.engine.readPaintTexture().pixels);
      painter.saveSnapshot();
      painter.setPaletteMode('digital');
      painter.setPaintColor('#F97316');
      const rect = painter.paintingRectangle;
      painter.engine.beginStroke({ timing: 'live', x: rect.left + rect.width * .58, y: rect.bottom + rect.height * .55,
        brushSize: 50, paintingRectangle: rect, color: painter._strokeColor(),
        resolutionScale: painter.getEffectiveResolutionScale() });
      painter.engine.endStroke();
      const painted = Array.from(painter.engine.readPaintTexture().pixels);
      const historyIndex = painter.snapshotIndex;
      painter.setPaletteMode('natural');
      const switchPreservesHistory = painter.snapshotIndex === historyIndex;
      await painter.undo();
      const undone = Array.from(painter.engine.readPaintTexture().pixels);
      await painter.redo();
      const redone = Array.from(painter.engine.readPaintTexture().pixels);
      painter.newPaintingRectangle = painter.paintingRectangle.clone();
      painter.newPaintingRectangle.width += 12;
      painter.newPaintingRectangle.height += 8;
      painter.resizingSide = ResizingSide.TOP_RIGHT;
      const renders = [], render = painter.engine.renderToTexture.bind(painter.engine);
      painter.engine.renderToTexture = (options) => { renders.push({ model: options.colorModel, resizing: options.resizing }); return render(options); };
      painter.interactionState = InteractionMode.RESIZING; painter.needsRedraw = true; painter.update();
      painter.engine.renderToTexture = render; painter.interactionState = InteractionMode.NONE;
      painter._commitResize();
      const delta = (a, b) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
      return { switchPreservesHistory, undoDelta: delta(before, undone), redoDelta: delta(painted, redone),
        overlapMaterialDelta: delta(before, painted), resizePreview: renders };
    });
    assert.equal(results.history.switchPreservesHistory, true);
    assert.equal(results.history.undoDelta, 0); assert.equal(results.history.redoDelta, 0);
    assert.ok(results.history.overlapMaterialDelta > 0);
    assert.deepEqual(results.history.resizePreview, [{ model: 1, resizing: true }]);
    const afterHistoryResize = await exportState(first.page);
    await first.page.evaluate(() => {
      window.__painter.setPaletteMode('natural');
      window.__painter.setPaletteMode('digital');
    });
    const afterHistorySwitch = await exportState(first.page);
    results.historyResize = {
      rawDelta: maxDelta(afterHistoryResize.raw, afterHistorySwitch.raw),
      exportDelta: maxDelta(afterHistoryResize.pixels, afterHistorySwitch.pixels),
    };
    assert.equal(results.historyResize.rawDelta, 0);
    assert.equal(results.historyResize.exportDelta, 0);

    const backgroundBake = await first.page.evaluate(async () => {
      const painter = window.__painter;
      const bg = document.createElement('canvas');
      bg.width = 96; bg.height = 64;
      const ctx = bg.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, bg.width, bg.height);
      ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, bg.width / 2, bg.height);
      const blob = await new Promise((resolve) => bg.toBlob(resolve, 'image/png'));
      await painter.loadBackgroundImage(new File([blob], 'palette-background.png', { type: 'image/png' }));
      const before = Array.from(painter.engine.exportPixels({
        width: Math.round(painter.paintingRectangle.width),
        height: Math.round(painter.paintingRectangle.height),
        resolutionScale: painter.resolutionScale,
        colorModel: FluidEngine.COLOR_MODEL.RGB,
      }));
      painter.setPaletteMode('natural');
      const afterSwitch = Array.from(painter.engine.exportPixels({
        width: Math.round(painter.paintingRectangle.width),
        height: Math.round(painter.paintingRectangle.height),
        resolutionScale: painter.resolutionScale,
        colorModel: FluidEngine.COLOR_MODEL.RGB,
      }));
      await painter.bakeToBackground();
      const afterBake = Array.from(painter.engine.exportPixels({
        width: Math.round(painter.paintingRectangle.width),
        height: Math.round(painter.paintingRectangle.height),
        resolutionScale: painter.resolutionScale,
        colorModel: FluidEngine.COLOR_MODEL.RGB,
      }));
      return {
        before, afterSwitch, afterBake,
        materialMagnitude: Array.from(painter.engine.readPaintTexture().pixels)
          .reduce((sum, value) => sum + Math.abs(value), 0),
        hasBackground: painter.engine.renderer.hasBackground,
      };
    });
    results.backgroundBake = {
      switchDelta: maxDelta(backgroundBake.before, backgroundBake.afterSwitch),
      bakeDelta: maxDelta(backgroundBake.afterSwitch, backgroundBake.afterBake),
      materialMagnitude: backgroundBake.materialMagnitude,
      hasBackground: backgroundBake.hasBackground,
    };
    assert.equal(results.backgroundBake.switchDelta, 0);
    assert.ok(results.backgroundBake.bakeDelta <= 1);
    assert.equal(backgroundBake.materialMagnitude, 0);
    assert.equal(backgroundBake.hasBackground, true);

    results.png = await first.page.evaluate(async () => {
      const p = window.__painter, models = [], exported = p.engine.exportPixels.bind(p.engine);
      p.engine.exportPixels = (options) => { models.push(options.colorModel); return exported(options); };
      const before = await p.exportPngBlob(); p.setPaletteMode('digital'); const after = await p.exportPngBlob();
      p.engine.exportPixels = exported;
      const bytesBefore = new Uint8Array(await before.arrayBuffer()), bytesAfter = new Uint8Array(await after.arrayBuffer());
      const equal = bytesBefore.length === bytesAfter.length && bytesBefore.every((v, i) => v === bytesAfter[i]);
      return { equal, models, type: after.type, signature: Array.from(bytesAfter.slice(0, 8)),
        base64: btoa(String.fromCharCode(...bytesAfter)) };
    });
    assert.equal(results.png.equal, true); assert.deepEqual(results.png.models, [1, 1]);
    assert.equal(results.png.type, 'image/png');
    assert.deepEqual(results.png.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    fs.writeFileSync(path.join(output, 'paint-export.png'), Buffer.from(results.png.base64, 'base64'));
    delete results.png.base64;
    await first.page.screenshot({ path: path.join(output, 'paint-palette-main.png'), fullPage: true });
    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.consoleErrors, []);
    await first.page.close();

    const active = await makePage(browser, port, 'active');
    results.active = await active.page.evaluate(() => {
      const painter = window.__painter, engine = painter.engine, wgl = painter.wgl;
      const rect = painter.paintingRectangle;
      const delta = (a, b) => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);
      const exported = () => engine.exportPixels({ width: 180, height: 130,
        resolutionScale: painter.resolutionScale, colorModel: painter.colorModel });
      const run = (initial, mixed) => {
        engine.simulator.clearPaintAndDynamics();
        engine.resetClock(0);
        painter.setPaletteMode(initial);
        painter.setPaintColor([.13, .65, .8, 1]);
        engine.beginStroke({ timing: 'live', x: rect.left + 30, y: rect.bottom + 40,
          brushSize: 45, paintingRectangle: rect, color: painter._strokeColor(),
          resolutionScale: painter.getEffectiveResolutionScale() });
        let steps = 0;
        for (let i = 1; i <= 10; i++) {
          engine.strokeTo({ x: rect.left + 30 + i * 8, y: rect.bottom + 40 + i });
          steps += engine.advance(i / 60).steps;
        }
        engine.endStroke();
        if (mixed) {
          painter.setPaletteMode('digital'); painter.setPaintColor([.7, .6, .9, 1]);
          engine.beginStroke({ timing: 'live', x: rect.left + 70, y: rect.bottom + 55,
            brushSize: 45, paintingRectangle: rect, color: painter._strokeColor(),
            resolutionScale: painter.getEffectiveResolutionScale() });
          engine.endStroke();
        }
        const snapshot = engine.createSnapshot(rect.width, rect.height, painter.resolutionScale);
        engine.saveSnapshot(snapshot, rect.width, rect.height, painter.resolutionScale);
        const simulate = (switches) => {
          engine.simulator.clearPaintAndDynamics();
          engine.restoreSnapshot(snapshot, engine.simulator.resolutionWidth, engine.simulator.resolutionHeight);
          engine.resetClock(0);
          engine.simulator.splatAreas = [{ rectangle: new Rectangle(0, 0,
            engine.simulator.resolutionWidth, engine.simulator.resolutionHeight),
            frameNumber: engine.simulator.frameNumber }];
          steps = 0;
          const fb = wgl.createFramebuffer();
          for (const texture of [engine.simulator.velocityTexture, engine.simulator.velocityTextureTemp]) {
            wgl.framebufferTexture2D(fb, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, texture, 0);
            wgl.clear(wgl.createClearState().bindFramebuffer(fb).clearColor(2, 1, 0, 0), wgl.COLOR_BUFFER_BIT);
          }
          wgl.deleteFramebuffer(fb);
          const before = engine.readPaintTexture().pixels, beforeExport = exported();
          if (switches) { painter.setPaletteMode('digital'); painter.setPaletteMode('natural'); }
          const frozenRawDelta = delta(before, engine.readPaintTexture().pixels);
          const frozenExportDelta = delta(beforeExport, exported());
          for (let i = 1; i <= 30; i++) {
            if (switches) painter.setPaletteMode(i % 2 ? 'natural' : 'digital');
            steps += engine.advance(i / 60).steps;
          }
          const raw = engine.readPaintTexture().pixels;
          return { raw, pixels: exported(), steps, frozenRawDelta, frozenExportDelta,
            movedRawDelta: delta(before, raw) };
        };
        const a = simulate(false), b = simulate(true);
        wgl.deleteTexture(snapshot.texture);
        return { initial, mixed, steps: b.steps, rawDelta: delta(a.raw, b.raw),
          exportDelta: delta(a.pixels, b.pixels), frozenRawDelta: b.frozenRawDelta,
          frozenExportDelta: b.frozenExportDelta, movedRawDelta: b.movedRawDelta };
      };
      // Same initial material and dynamics, same engine and exact step count.
      return [['natural', false], ['digital', false], ['natural', true]].map(([initial, mixed]) => run(initial, mixed));
    });
    for (const pair of results.active) {
      assert.equal(pair.rawDelta, 0); assert.equal(pair.exportDelta, 0);
      assert.equal(pair.frozenRawDelta, 0); assert.equal(pair.frozenExportDelta, 0);
      assert.equal(pair.steps, 30); assert.ok(pair.movedRawDelta > 0);
    }
    await active.page.screenshot({ path: path.join(output, 'paint-palette-active.png'), fullPage: true });
    assert.deepEqual(active.errors, []); assert.deepEqual(active.consoleErrors, []);
    await active.page.close();

    const ui = await makePage(browser, port, 'ui-api-story');
    results.uiApi = await ui.page.evaluate(async () => {
      const p = window.__painter;
      const check = (ok, text) => { if (!ok) throw new Error(text); };
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const expected = [0x12 / 255, 0x34 / 255, 0x56 / 255];
      const api = new FluidControlApi(p, p.storyPlaybackController);
      api.configureMode('fluid-rescript', { palette: ['#123456', 'white', 'black'] });
      api.activateTransfer('palette-probe');
      await api.execute({ transferId: 'palette-probe', command: 'setPaintColor', value: '#123456' });
      for (const mode of ['natural', 'digital', 'natural']) {
        p.setPaletteMode(mode); check(same(p._paintRgb(), expected), 'HEX switches preserve base RGB');
        check(document.getElementById('paint-color-hex').textContent === '#123456', 'HEX readout');
      }
      p.colorControl.picker.color.alpha = .25;
      check(same(p._paintRgb(), expected), 'alpha preserves HEX');
      check(document.getElementById('paint-color-alpha').textContent === '40', 'alpha readout');
      const draws = {};
      const oldMarker = p.brushCenterMarker, oldViewer = p.brushViewer;
      p.brushCenterMarker = { draw: (...args) => { draws.marker = args.at(-1).slice(); } };
      p.brushViewer = { draw: (...args) => { draws.viewer = args.at(-1).slice(); } };
      p.brushX = p.mouseX = p.paintingRectangle.left + 90;
      p.brushY = p.mouseY = p.paintingRectangle.bottom + 60;
      p.interactionState = InteractionMode.PAINTING;
      p.update();
      p.interactionState = InteractionMode.NONE;
      p.brushCenterMarker = oldMarker; p.brushViewer = oldViewer;
      check(same(draws.marker, expected) && same(draws.viewer, expected), 'exact HEX reaches both production preview draw paths');
      p._beginPaintStroke(1, 'mouse');
      const frozen = p.engine._stroke.color.slice();
      p.setPaletteMode('digital'); p.setPaintColor('#F97316');
      p.engine.strokeTo({ x: p.brushX + 20, y: p.brushY });
      check(same(p.engine._stroke.color, frozen), 'manual active stroke freezes color');
      p.engine.endStroke(); p.manualStrokeActive = false;
      for (const endpoint of ['white', 'black']) {
        await api.execute({ transferId: 'palette-probe', command: 'setPaintColor', value: endpoint });
        const rgb = endpoint === 'white' ? [1, 1, 1] : [0, 0, 0];
        for (const mode of ['natural', 'digital']) {
          p.setPaletteMode(mode); check(same(p._paintRgb(), rgb), 'endpoint switch');
        }
        p.colorControl.picker.color.alpha = .4;
        check(same(p._paintRgb(), rgb), 'endpoint alpha');
      }
      p.setPaintColor('#123456'); p.colorControl.picker.color.hue = 90;
      check(p.exactPaintRgb === null && p.adhocPaintColor === null, 'H change replaces exact RGB');
      p.setPaintColor('#123456'); p.colorControl.picker.color.saturation = 60;
      check(p.exactPaintRgb === null, 'S change replaces exact RGB');
      p.setPaintColor('#123456'); p.colorControl.picker.color.value = 80;
      check(p.exactPaintRgb === null, 'V change replaces exact RGB');
      api.dispose();
      return { pass: true, previews: draws, frozenStroke: frozen,
        exactHex: '#123456', alphaReadout: '40', hsvReplacement: ['H', 'S', 'V'], endpoints: ['white', 'black'] };
    });
    await ui.page.click('#panel-grip');
    await ui.page.evaluate(() => { const p = window.__painter; p.setPaintColor('#123456'); p.setPaletteMode('natural'); p.colorControl.picker.color.alpha = .25; });
    await ui.page.locator('#models > div').filter({ hasText: 'Digital' }).click();
    assert.equal(await ui.page.locator('#paint-color-hex').textContent(), '#123456');
    await ui.page.locator('#models > div').filter({ hasText: 'Natural' }).click();
    assert.equal(await ui.page.locator('#paint-color-hex').textContent(), '#123456');
    await ui.page.click('#paint-color-white');
    assert.equal(await ui.page.locator('#paint-color-hex').textContent(), '#FFFFFF');
    await ui.page.click('#paint-color-black');
    assert.equal(await ui.page.locator('#paint-color-hex').textContent(), '#000000');
    await ui.page.evaluate(() => window.__painter.setPaintColor('#123456'));
    await ui.page.screenshot({ path: path.join(output, 'paint-palette-hex.png'), fullPage: true });
    results.story = await ui.page.evaluate(async () => {
      const p = window.__painter, c = p.storyPlaybackController;
      const model = { layers: [{ visible: true, tileShape: 'polygon', gridSize: 30, opacity: 255,
        tiles: [{ x: 20, y: 20, c: '#3B82F6', s: 1 }] }] };
      await c.loadModel(model); c.setSpeed(16); c.setCanvasPolicy('overlay');
      const colors = [], begin = p.engine.beginStroke.bind(p.engine);
      p.engine.beginStroke = (options) => { colors.push(options.color.channels.slice()); return begin(options); };
      const expected = PaintColorAdapter.encodeRgb(PaintColorAdapter.hexRgb('#3B82F6'));
      await c.play();
      const completed = c.state;
      const refused = c.setColorModel('digital') === false;
      await c.restart();
      const restarted = c.state;
      await c.loadModel(model); c.setColorModel('digital'); await c.play(); await c.restart();
      p.engine.beginStroke = begin;
      if (!refused || colors.length !== 4 || colors.some((color) => JSON.stringify(color) !== JSON.stringify(expected)))
        throw new Error('Story HEX/restart/restrictions failed: ' + JSON.stringify({ colors, refused, completed, restarted }));
      return { pass: true, completed, restarted, refused, colors };
    });
    assert.equal(await ui.page.locator('#story-color-model').isDisabled(), true);
    await ui.page.evaluate(() => window.__painter.toolPanel.selectExtensionTab('player'));
    await ui.page.click('#panel-extension-toggle');
    await ui.page.click('#story-player-tab');
    assert.equal(await ui.page.locator('#story-player-page').isVisible(), true);
    await ui.page.screenshot({ path: path.join(output, 'paint-palette-story.png'), fullPage: true });
    assert.deepEqual(ui.errors, []); assert.deepEqual(ui.consoleErrors, []);
    await ui.page.close();

    const minimal = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const minimalErrors = []; minimal.on('pageerror', (e) => minimalErrors.push(e.message));
    await minimal.goto(`http://127.0.0.1:${port}/examples/minimal/index.html`);
    await minimal.waitForFunction(() => window.__minimalHost?.engine?.capabilities.canDepositPaint);
    results.minimal = await minimal.evaluate(() => {
      const h = window.__minimalHost, models = [], render = h.engine.renderToTexture.bind(h.engine);
      h.engine.renderToTexture = (options) => { models.push(options.colorModel); return render(options); };
      const r = h.paintingRectangle;
      h.engine.beginStroke({ timing: 'live', x: r.left + 60, y: r.bottom + 60, brushSize: 35,
        paintingRectangle: r, color: { space: 'pigment', channels: [1, 0, 0], alpha: .1 }, resolutionScale: 1 });
      h.engine.endStroke(); h.needsRedraw = true; h._update();
      h.engine.renderToTexture = render;
      const magnitude = h.engine.readPaintTexture().pixels.reduce((sum, v) => sum + Math.abs(v), 0);
      return { models, magnitude, adapterAbsent: typeof PaintColorAdapter === 'undefined' };
    });
    assert.deepEqual(results.minimal.models, [0]); assert.ok(results.minimal.magnitude > 0);
    assert.equal(results.minimal.adapterAbsent, true); assert.deepEqual(minimalErrors, []);
    await minimal.screenshot({ path: path.join(output, 'minimal-legacy.png'), fullPage: true });
    await minimal.close();

    results.exitCode = 0;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    results.exitCode = 1;
    results.error = error.stack;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve, reject) => {
      const check = require('node:net').createServer();
      check.once('error', reject);
      check.listen(port, '127.0.0.1', () => check.close(resolve));
    });
    console.log('Evidence: ' + output);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
