'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('origin polyline GPU check');

const root = path.resolve(__dirname, '..');
const modelPath = process.env.TILECRAFT_ORIGIN_PATH ||
  path.join(root, 'debug/fixtures/tilecraft-spot-parity.json');
const origin = JSON.parse(fs.readFileSync(modelPath));
const mime = { '.js': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain' };
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
    '--renderer-process-limit=1',
  ] });
  try {
    for (const size of [900, 1400]) {
      const page = await browser.newPage({ viewport: { width: size, height: Math.round(size * 0.75) } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none&diag=0`);
      await page.waitForFunction(() => window.__painter?.engine);
      const result = await page.evaluate(async (model) => {
        const painter = window.__painter;
        painter.update = () => {};
        const engine = painter.engine;
        engine.clear();
        const tiles = model.layers.flatMap((layer) => layer.tiles);
        const bounds = {
          left: Math.min(...tiles.map((tile) => tile.x)),
          right: Math.max(...tiles.map((tile) => tile.x)),
          top: Math.min(...tiles.map((tile) => tile.y)),
          bottom: Math.max(...tiles.map((tile) => tile.y)),
        };
        const rect = painter.paintingRectangle.clone();
        const scale = Math.min(rect.width / (bounds.right - bounds.left),
          rect.height / (bounds.bottom - bounds.top));
        const offsetX = rect.left + (rect.width - (bounds.right - bounds.left) * scale) / 2;
        const offsetY = rect.bottom + (rect.height - (bounds.bottom - bounds.top) * scale) / 2;
        const pathModel = { layers: [model.layers.find((layer) => layer.tileShape === 'polyline')] };
        const player = new window.TilecraftStrokePlayer(engine);
        const options = {
          paintingRectangle: rect, coordinateScale: scale,
          canvasSize: { width: rect.width, height: rect.height },
          canvasColorFormat: 'encoded-rgb',
          encodeRgb: (rgb) => [1 - rgb[1], 1 - rgb[0], 1 - rgb[2]],
          alpha: 0.04,
          mapPoint: (tile) => ({
            x: offsetX + (tile.x - bounds.left) * scale,
            y: offsetY + (bounds.bottom - tile.y) * scale,
          }),
        };
        const plan = player.compile(pathModel, options);
        await player.playPlan(plan, { waitFrame: async () => {}, targetDuration: 0,
          advanceTick: async () => {}, resetAdvanceClock: () => {} });
        const { width, height, pixels } = engine.readPaintTexture();
        let visible = 0, alphaSum = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          const alpha = pixels[i];
          if (alpha > 0.01) visible++;
          alphaSum += alpha;
        }
        let covered = 0, sampled = 0;
        for (let i = 1; i < plan.operations.length; i++) {
          const previous = plan.operations[i - 1];
          const current = plan.operations[i];
          if (current.segmentKey !== previous.segmentKey) continue;
          for (const t of [0.25, 0.5, 0.75]) {
            const x = previous.point.x + (current.point.x - previous.point.x) * t;
            const y = previous.point.y + (current.point.y - previous.point.y) * t;
            const px = Math.floor((x - rect.left) / rect.width * width);
            const py = Math.floor((y - rect.bottom) / rect.height * height);
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            sampled++;
            if (pixels[(py * width + px) * 4 + 3] > 0.01) covered++;
          }
        }
        const midY = rect.bottom + rect.height * 0.5;
        const midX = rect.left + rect.width * 0.5;
        const joinModel = { layers: [{ visible: true, tileShape: 'polyline', gridSize: 28,
          tiles: [
            { x: midX - 24, y: midY, c: '#ff0000', g: 1 },
            { x: midX, y: midY, c: '#ff0000', g: 1 },
            { x: midX + 24, y: midY, c: '#ff0000', g: 1 },
          ] }] };
        const joinOptions = { ...options, coordinateScale: 1,
          mapPoint: (tile) => ({ x: tile.x, y: tile.y }) };
        const sampleJoint = async (correct) => {
          engine.clear();
          const joinPlan = player.compile(joinModel,
            { ...joinOptions, pathJoinCorrection: correct });
          await player.playPlan(joinPlan, { waitFrame: async () => {} });
          const image = engine.readPaintTexture();
          const x = Math.floor((midX - rect.left) / rect.width * image.width);
          const y = Math.floor((midY - rect.bottom) / rect.height * image.height);
          return image.pixels[(y * image.width + x) * 4 + 3];
        };
        const legacyJointAlpha = await sampleJoint(false);
        const correctedJointAlpha = await sampleJoint(true);
        engine.clear();
        const fullPlan = player.compile(model, options);
        await player.playPlan(fullPlan, { waitFrame: async () => {}, targetDuration: 0,
          advanceTick: async () => {}, resetAdvanceClock: () => {} });
        const fullPixels = engine.readPaintTexture().pixels;
        let fullVisible = 0;
        for (let i = 3; i < fullPixels.length; i += 4) if (fullPixels[i] > 0.01) fullVisible++;
        return { visible, alphaSum, covered, sampled, scale, fullVisible,
          legacyJointAlpha, correctedJointAlpha,
          operations: plan.operations.length, groups: plan.groupRanges.length,
          glError: painter.wgl.gl.getError() };
      }, origin);
      assert.deepEqual(errors, []);
      assert.equal(result.glError, 0);
      assert.equal(result.groups,
        new Set(origin.layers.find((layer) => layer.tileShape === 'polyline').tiles.map((tile) => tile.g)).size,
        'width splits preserve the source navigation groups');
      assert.ok(result.visible > 100, `no visible path at ${size}: ${JSON.stringify(result)}`);
      assert.equal(result.covered, result.sampled,
        `path has gaps at ${size}: ${JSON.stringify(result)}`);
      assert.ok(result.alphaSum / result.visible > 0.2,
        `continuous path lacks contrast at ${size}: ${JSON.stringify(result)}`);
      assert.ok(result.fullVisible > result.visible,
        `the mixed story failed to paint its spot layers at ${size}: ${JSON.stringify(result)}`);
      assert.ok(result.correctedJointAlpha < result.legacyJointAlpha * 0.7,
        `join correction did not reduce the node at ${size}: ${JSON.stringify(result)}`);
      assert.ok(result.correctedJointAlpha > 0.35,
        `join correction erased the path at ${size}: ${JSON.stringify(result)}`);
      console.log(JSON.stringify({ size, ...result }));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
