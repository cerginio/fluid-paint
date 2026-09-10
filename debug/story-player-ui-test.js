'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Story player UI');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'docs', 'story-2026-09-08-4-frames.json');
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
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none`);
    await page.waitForFunction(() => window.__painter && window.__painter.storyPlaybackController);

    await page.click('#panel-extension-toggle');
    await page.setInputFiles('#story-file-input', fixture);
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'ready');
    assert.equal(await page.locator('#story-player-page').isVisible(), true, 'valid file opens Player tab');
    assert.match(await page.locator('#story-player-file-name').textContent(), /story-2026/);
    assert.equal(await page.locator('#story-thickness').getAttribute('min'), '0.1',
      'thickness range starts at 0.1');
    assert.equal(await page.locator('#story-thickness').inputValue(), '1',
      'thickness multiplier defaults to 1');
    assert.deepEqual(await page.evaluate(() => ({
      min: window.__painter.fluiditySlider.minValue,
      max: window.__painter.fluiditySlider.maxValue,
    })), { min: 0.1, max: 0.9 }, 'fluidity slider covers the 0.1–0.9 range');
    assert.equal(await page.locator('#story-player-gaps').isHidden(), true,
      'remaining-ranges callout is hidden while the story is ready');
    assert.equal(await page.locator('#story-stop-decision').isHidden(), true,
      'result-decision callout is hidden while the story is ready');

    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.progress.paintedOperations > 2);
    assert.equal(await page.locator('#story-player-gaps').isHidden(), true,
      'remaining-ranges callout stays hidden during playback');
    assert.equal(await page.locator('#story-stop-decision').isHidden(), true,
      'result-decision callout stays hidden during playback');
    await page.selectOption('#story-speed', '0.5');
    await page.locator('#story-thickness').fill('0.6');
    await page.waitForFunction(() => {
      const settings = window.__painter.storyPlaybackController.activeRunSettings;
      return settings && settings.speed === 0.5 && settings.thickness === 0.6;
    });
    assert.equal(await page.locator('#story-thickness-value').textContent(), '0.60×',
      'thickness output follows the live range input');
    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'paused');
    await page.selectOption('#story-speed', '2');
    await page.waitForFunction(() => {
      const controller = window.__painter.storyPlaybackController;
      return controller.state === 'paused' && !controller._runPromise;
    });
    await page.click('#story-play-pause');
    await page.waitForFunction(() => {
      const controller = window.__painter.storyPlaybackController;
      return controller.state === 'playing' && controller.activeRunSettings.speed === 2;
    });
    assert.equal(await page.locator('#panel-body').evaluate((element) => element.inert), false,
      'story playback never makes paint controls inert');
    const manualTakeover = await page.evaluate(async () => {
      const painter = window.__painter;
      await painter.storyPlaybackController.yieldToManualInput();
      const storyStrokeClosed = !painter.engine.strokeActive;
      painter.brushX = 100;
      painter.brushY = 100;
      painter._beginPaintStroke(0.5, 'mouse');
      const manualStrokeStarted = painter.engine.strokeActive;
      painter.engine.endStroke();
      return { state: painter.storyPlaybackController.state, storyStrokeClosed, manualStrokeStarted };
    });
    assert.deepEqual(manualTakeover, {
      state: 'paused', storyStrokeClosed: true, manualStrokeStarted: true,
    }, 'manual input pauses story and starts without competing strokes');

    const beforeJump = await page.evaluate(() => window.__painter.storyPlaybackController.playheadIndex);
    await page.click('#story-next-frame');
    await page.waitForFunction((before) => {
      const controller = window.__painter.storyPlaybackController;
      return controller.state === 'paused' && controller.playheadIndex > before;
    }, beforeJump);
    assert.ok((await page.evaluate(() => window.__painter.storyPlaybackController.getPendingRanges().length)) > 0,
      'forward frame jump keeps unpainted ranges in registry');

    const afterForwardJump = await page.evaluate(() => window.__painter.storyPlaybackController.playheadIndex);
    await page.click('#story-previous-frame');
    await page.waitForFunction((before) => window.__painter.storyPlaybackController.playheadIndex < before, afterForwardJump);

    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'playing');
    await page.click('#story-stop');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'stop-decision');
    await page.click('#story-restore-baseline');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'ready');

    await page.evaluate(async () => {
      const model = {
        layers: [{
          visible: true, tileShape: 'polygon', gridSize: 10, scale: 1,
          tiles: [{ x: 0, y: 0, c: '#ff0000', f: 1, g: 1, s: 1 }],
        }],
        frames: [{ id: 1 }],
      };
      const summary = StoryFileLoader.summarize(model, 'completion-smoke.json', 1);
      await window.__painter.storyPlaybackController.loadModel(model, summary);
    });
    await page.selectOption('#story-speed', '16');
    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'completed');
    assert.equal(await page.locator('#story-stop-decision').isVisible(), true,
      'completed playback requires an explicit keep or restore decision');
    assert.equal(await page.locator('#story-player-gaps').isHidden(), true,
      'completed playback does not show the mutually exclusive gaps callout');
    assert.equal(await page.evaluate(() => window.__painter.storyPlaybackController.canPaintManually), true,
      'completed playback does not lock manual painting');
    await page.evaluate(() => window.__painter.storyPlaybackController.yieldToManualInput());
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'ready');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => {
      const extension = document.getElementById('panel-extension').getBoundingClientRect();
      const controls = [
        ...document.querySelectorAll(
          '#panel-extension button:not([hidden]), #panel-extension select:not([hidden]), ' +
          '#panel-extension input[type="range"]:not([hidden])'
        ),
      ].filter((control) => control.offsetParent !== null).map((control) => ({
        id: control.id,
        height: control.getBoundingClientRect().height,
      }));
      return {
        extension: {
          left: extension.left,
          right: extension.right,
          bottom: extension.bottom,
          height: extension.height,
        },
        controls,
      };
    });
    assert.ok(mobileLayout.extension.left >= 0 && mobileLayout.extension.right <= 390,
      'mobile story sheet stays inside the viewport');
    assert.ok(mobileLayout.extension.bottom <= 844 && mobileLayout.extension.height <= 0.72 * 844 + 1,
      'mobile story sheet respects its viewport height limit');
    assert.deepEqual(mobileLayout.controls.filter((control) => control.height < 44), [],
      'visible mobile story controls have at least 44px touch targets');

    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => window.__painter.wgl.gl.getError()), 0);
    console.log('story player UI: PASS (live speed/thickness, manual takeover, jumps, registry, mobile layout)');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
