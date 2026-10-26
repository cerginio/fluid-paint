'use strict';

// Starts the supplied Tilecraft fixture through the actual browser engine.
// Full live playback is intentionally not awaited here: the production fixture
// has tens of thousands of points. This checks that playback deposits paint;
// continuous GPU paths need no bristle stroke to remain active.
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
      painted: (() => {
        const { pixels } = window.__painter.engine.readPaintTexture();
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true;
        return false;
      })(),
      glError: window.__painter.wgl.gl.getError(),
    }));
    assert.deepEqual(errors, []);
    assert.equal(result.painted, true);
    assert.equal(result.glError, 0);
    console.log(JSON.stringify({ story: 'story-2026-09-08-4-frames.json', ...result }));
    await page.close();

    /* AC-MAX-2 / AC-MAX-3. Max must change only how ticks are grouped into
     * frames, so the same plan on a fresh page with the same seed paints the
     * same bytes at 16x and at Max. The fixture is sliced to its first tiles
     * per layer: SwiftShader cannot play all 22 720 in a test's time. Each run
     * slows every tick past 1/60 s; the former synthetic clock inserted extra
     * interpolated steps exactly then, so a slow tick is the case to cover. */
    const base = `http://127.0.0.1:${server.address().port}/index.html?debug=none&diag=0&seed=7`;
    const runAt = async (speed, tilesPerLayer, tickDelayMs) => {
      const runPage = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
      const runErrors = [];
      runPage.on('pageerror', (error) => runErrors.push(error.message));
      await runPage.goto(base);
      await runPage.waitForFunction(() => window.__painter && window.__painter.engine &&
        window.__painter.storyPlaybackController);
      const value = await runPage.evaluate(async ({ speed, tilesPerLayer, tickDelayMs }) => {
        const painter = window.__painter;
        const engine = painter.engine;
        const controller = painter.storyPlaybackController;
        const story = await fetch('docs/story-2026-09-08-4-frames.json').then((r) => r.json());
        story.layers = story.layers.map((layer) =>
          ({ ...layer, tiles: (layer.tiles || []).slice(0, tilesPerLayer) }));
        await controller.loadModel(story, StoryFileLoader.summarize(story, 'slice.json'));
        controller.setSpeed(speed);
        const simulate = engine.simulator.simulate.bind(engine.simulator);
        let simulateCalls = 0;
        engine.simulator.simulate = () => { simulateCalls++; return simulate(); };
        const tick = controller._advanceStoryTick.bind(controller);
        const stepsPerTick = [];
        controller._advanceStoryTick = () => {
          const until = performance.now() + tickDelayMs;
          while (performance.now() < until) { /* a slow GPU tick */ }
          tick();
          stepsPerTick.push(engine.timingStats.steps);
        };
        // A late frame: wall time passes after the clock returns to the host,
        // which is when a host RAF step could land between two story frames.
        const reset = controller._resetStoryClock.bind(controller);
        controller._resetStoryClock = () => {
          reset();
          const until = performance.now() + tickDelayMs;
          while (performance.now() < until) { /* jank before the next frame */ }
        };
        const started = performance.now();
        await controller.play();
        const seconds = (performance.now() - started) / 1000;
        const runSimulateCalls = simulateCalls;
        engine.simulator.simulate = simulate;
        // Settle: a splat area stops simulating after 60 steps, so more steps
        // than that leave both runs at the same quiescent state.
        for (let i = 0; i < 80; i++) engine.stepTick();
        const pixels = engine.exportPixels({
          width: painter.paintingRectangle.width, height: painter.paintingRectangle.height,
          resolutionScale: painter.resolutionScale,
        });
        let hash = 0x811c9dc5, painted = 0;
        for (let i = 0; i < pixels.length; i++) {
          hash = Math.imul(hash ^ pixels[i], 0x01000193) >>> 0;
        }
        // The export composites over opaque white, so paint is any non-white pixel.
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) painted++;
        }
        return {
          state: controller.state, ticks: stepsPerTick.length,
          multiStepTicks: stepsPerTick.filter((steps) => steps !== 1).length,
          simulateCalls: runSimulateCalls, hash, painted, seconds,
          operations: controller.plan.operations.length,
        };
      }, { speed, tilesPerLayer, tickDelayMs });
      assert.deepEqual(runErrors, []);
      await runPage.close();
      return value;
    };
    const sixteen = await runAt(16, 150, 20);
    const max = await runAt('max', 150, 20);
    console.log(JSON.stringify({ check: 'AC-MAX-2/3', sixteen, max }));
    for (const run of [sixteen, max]) {
      assert.equal(run.state, 'completed');
      assert.ok(run.ticks > 0 && run.painted > 0, 'the slice paints something to compare');
      assert.equal(run.multiStepTicks, 0, 'INV-MAX-1: every story tick is exactly one step, even past 1/60 s');
      assert.equal(run.simulateCalls, run.ticks,
        'INV-MAX-1: a playing story is the only source of simulation steps');
    }
    assert.equal(max.ticks, sixteen.ticks, 'Max and 16x run the same ticks');
    assert.equal(max.hash, sixteen.hash, 'AC-MAX-2: Max paints the same bytes as 16x');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
