'use strict';

// Compare one imported polygon spot with one manual pen-down contact under
// identical brush settings and seeded GPU state. The readback measures paint,
// not the rendered RGB background.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Tilecraft spot GPU');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.vert': 'text/plain', '.frag': 'text/plain', '.json': 'application/json' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});

async function measure(page, replay) {
  return page.evaluate((asReplay) => {
    const painter = window.__painter;
    painter.update = () => {};
    const engine = painter.engine;
    engine.clear();
    painter.adhocPaintColor = 'black';
    const rectangle = painter.paintingRectangle;
    const x = rectangle.left + rectangle.width / 2;
    const y = rectangle.bottom + rectangle.height / 2;
    const shape = { sides: 3, rotation: Math.PI / 2 };
    const brushSize = 60;
    const alpha = painter._strokeColor().alpha;
    if (asReplay) {
      const areaFraction = 3 * Math.sin(2 * Math.PI / 3) / (2 * Math.PI);
      const player = new TilecraftStrokePlayer(engine);
      player.replay({ layers: [{ visible: true, tileShape: 'polygon', polygonSize: 3,
        gridSize: brushSize / (0.665 * Math.sqrt(areaFraction)), opacity: 255,
        tiles: [{ x, y, c: '#000000', a: 255, sa: 0 }] }] }, {
        paintingRectangle: rectangle, canvasSize: { width: rectangle.width, height: rectangle.height },
        alpha, mapPoint: (tile) => ({ x: tile.x, y: tile.y }),
      });
    } else {
      painter.brushX = x;
      painter.brushY = y;
      painter.brushScale = brushSize;
      painter.brushShape = shape;
      painter._beginPaintStroke(1, 'mouse');
      engine.endStroke();
      painter.manualStrokeActive = false;
    }
    const { width, height, pixels } = engine.readPaintTexture();
    let mass = 0, area = 0, cx = 0, cy = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const value = Math.max(0, pixels[i]);
      mass += value;
      if (value > 0.01) area++;
      const pixel = (i - 3) / 4;
      cx += (pixel % width) * value;
      cy += Math.floor(pixel / width) * value;
    }
    cx /= mass; cy /= mass;
    const profile = new Array(180).fill(0);
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (pixels[pixel * 4 + 3] <= 0.01) continue;
      const dx = pixel % width - cx, dy = Math.floor(pixel / width) - cy;
      const angle = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
      const bin = Math.min(179, Math.floor(angle / (2 * Math.PI) * 180));
      profile[bin] = Math.max(profile[bin], Math.hypot(dx, dy));
    }
    const mean = profile.reduce((sum, value) => sum + value, 0) / profile.length;
    const re = profile.reduce((sum, value, i) => sum + value * Math.cos(3 * i * 2 * Math.PI / 180), 0);
    const im = profile.reduce((sum, value, i) => sum + value * Math.sin(3 * i * 2 * Math.PI / 180), 0);
    const h3 = 2 * Math.hypot(re, im) / (mean * 180);
    return { width, height, mass, area, alpha, h3 };
  }, replay);
}

async function measurePath(page, replay) {
  return page.evaluate(async (asReplay) => {
    const painter = window.__painter;
    painter.update = () => {};
    const engine = painter.engine;
    engine.clear();
    painter.adhocPaintColor = 'black';
    const rectangle = painter.paintingRectangle;
    const x = rectangle.left + rectangle.width / 2 - 40;
    const y = rectangle.bottom + rectangle.height / 2;
    const brushSize = 40;
    const alpha = painter._strokeColor().alpha;
    engine.resetClock(0);
    if (asReplay) {
      const ratio = Math.min(1, Math.max(rectangle.width, rectangle.height) / 3000);
      const player = new TilecraftStrokePlayer(engine);
      const plan = player.compile({ layers: [{ visible: true, tileShape: 'polyline',
        gridSize: brushSize / ratio, opacity: 255, tiles: [
          { x, y, c: '#000000', g: 1 }, { x: x + 80, y, c: '#000000', g: 1 },
        ] }] }, { paintingRectangle: rectangle,
        canvasSize: { width: rectangle.width, height: rectangle.height }, alpha });
      await player.playPlan(plan, { ticksPerFrame: 2,
        advanceTick: () => engine.advance(1 / 60), waitFrame: async () => {} });
    } else {
      painter.brushX = x; painter.brushY = y; painter.brushScale = brushSize;
      painter.brushShape = null;
      painter._beginPaintStroke(1, 'mouse');
      engine.strokeTo({ x: x + 80, y, pressure: 1 });
      engine.advance(1 / 60);
      engine.endStroke();
      painter.manualStrokeActive = false;
    }
    const { pixels } = engine.readPaintTexture();
    let mass = 0, area = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      const value = Math.max(0, pixels[i]);
      mass += value;
      if (value > 0.01) area++;
    }
    return { mass, area, alpha };
  }, replay);
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
  try {
    const results = [];
    for (const replay of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260930&debug=none`);
      await page.waitForFunction(() => window.__painter?.engine);
      results.push(await measure(page, replay));
      await page.close();
    }
    const [manual, replay] = results;
    const massRatio = replay.mass / manual.mass;
    const areaRatio = replay.area / manual.area;
    console.log(JSON.stringify({ manual, replay, massRatio, areaRatio }));
    assert.ok(manual.mass > 0 && replay.mass > 0, 'both contacts deposit paint');
    assert.ok(massRatio >= 0.85 && massRatio <= 1.15, 'spot alpha mass matches one manual tap');
    assert.ok(areaRatio >= 0.85 && areaRatio <= 1.15, 'spot coverage matches one manual tap');
    assert.ok(manual.h3 > 0.1 && replay.h3 > 0.1, 'both contacts have a triangular footprint');

    const pathResults = [];
    for (const asReplay of [false, true]) {
      const pathPage = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
      await pathPage.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260930&debug=none`);
      await pathPage.waitForFunction(() => window.__painter?.engine);
      pathResults.push(await measurePath(pathPage, asReplay));
      await pathPage.close();
    }
    const [manualPath, replayPath] = pathResults;
    const pathMassRatio = replayPath.mass / manualPath.mass;
    const pathAreaRatio = replayPath.area / manualPath.area;
    console.log(JSON.stringify({ manualPath, replayPath, pathMassRatio, pathAreaRatio }));
    assert.ok(pathMassRatio >= 0.85 && pathMassRatio <= 1.15, 'path alpha mass matches one manual move');
    assert.ok(pathAreaRatio >= 0.85 && pathAreaRatio <= 1.15, 'path coverage matches one manual move');

    const page = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260930&debug=none`);
    await page.waitForFunction(() => window.__painter?.storyPlaybackController);
    await page.click('#panel-extension-toggle');
    await page.setInputFiles('#story-file-input', path.join(root, 'docs/spec/fluid-player-ux-fix/triangle-parity.json'));
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'ready');
    await page.locator('#story-color-model').selectOption('digital');
    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'completed');
    const ui = await page.evaluate(() => {
      const painter = window.__painter;
      const controller = painter.storyPlaybackController;
      return { colorModel: painter.colorModel, expectedModel: FluidEngine.COLOR_MODEL.RGB,
        sides: controller.plan.operations.map((operation) => operation.brushShape?.sides),
        red: controller.plan.operations[0].color.channels,
        alphas: controller.plan.operations.map((operation) => operation.color.alpha),
        rotations: controller.plan.operations.map((operation) => operation.brushShape?.rotation),
      };
    });
    assert.equal(ui.colorModel, ui.expectedModel, 'Digital selection reaches the shader model');
    assert.deepEqual(ui.red, [1, 0, 1], 'Digital red uses the RGB shader swizzle');
    assert.deepEqual(ui.sides, [3, 3, 3, 3, 3, 3], 'the imported fixture retains triangle footprints');
    assert.ok(ui.alphas[1] < ui.alphas[0], 'tile alpha reduces the second spot pigment load');
    assert.notEqual(ui.rotations[0], ui.rotations[1], 'per-tile rotation survives the player');
    assert.notEqual(ui.rotations[4], ui.rotations[5], 'mod 2 creates both orientations');
    await page.click('#story-keep-partial');
    await page.locator('#story-color-model').selectOption('natural');
    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'completed');
    const natural = await page.evaluate(() => ({
      model: window.__painter.colorModel,
      expected: FluidEngine.COLOR_MODEL.RYB,
      red: window.__painter.storyPlaybackController.plan.operations[0].color.channels,
    }));
    assert.equal(natural.model, natural.expected, 'Natural selection reaches the shader model');
    assert.deepEqual(natural.red, [1, 0, 0], 'Natural red uses the RYB corner');
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
