'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Story player UI');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'docs', 'story-2026-09-08-4-frames.json');
const pngFixture = path.join(root, 'docs', 'image.png');
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

    for (const [selector, expected] of [
      ['#fluidity-slider', /^0\.\d{2}$/],
      ['#bristles-slider', /^\d+$/],
      ['#size-slider', /^\d+ px$/],
    ]) {
      const box = await page.locator(selector).boundingBox();
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
      const pop = page.locator(`${selector} .slider-value-pop`);
      assert.equal(await pop.isVisible(), true, `${selector} shows its value pop`);
      assert.match(await pop.textContent(), expected, `${selector} formats its displayed value`);
    }

    const originalHsva = await page.evaluate(() => window.__painter.brushColorHSVA.slice());
    assert.deepEqual(await page.locator('.adhoc-color').allTextContents(), ['#fff', '#000'],
      'ad-hoc actions use compact hex labels');
    const adhocShape = await page.locator('#paint-color-black').evaluate((button) => {
      const style = getComputedStyle(button);
      return { width: button.offsetWidth, height: button.offsetHeight, radius: style.borderRadius };
    });
    assert.equal(adhocShape.width, adhocShape.height, 'ad-hoc action is square');
    assert.equal(adhocShape.radius, '50%', 'ad-hoc action is circular');
    await page.click('#paint-color-black');
    assert.equal(await page.locator('#paint-color-black').getAttribute('aria-pressed'), 'true',
      'Black exposes its selected state');
    assert.equal(await page.locator('#paint-color-hex').textContent(), '#000000');
    assert.deepEqual(await page.evaluate(() => ({
      hsva: window.__painter.brushColorHSVA.slice(),
      channels: window.__painter._strokeColor().channels,
      adhoc: window.__painter.adhocPaintColor,
    })), { hsva: originalHsva, channels: [1, 1, 1], adhoc: 'black' },
    'ad-hoc black uses the exact pigment corner without mutating HSVA');
    assert.equal(await page.locator('.IroWheel .IroHandle--0 circle:last-child').evaluate(
      (circle) => getComputedStyle(circle).fill
    ), 'rgb(0, 0, 0)', 'ad-hoc black paints the iro handle black');
    const beforeAdhocAlpha = await page.evaluate(() => window.__painter._strokeColor().alpha);
    await page.evaluate(() => { window.__painter.colorControl.picker.color.alpha = 0.35; });
    const adhocAlpha = await page.evaluate(() => ({
      adhoc: window.__painter.adhocPaintColor,
      alpha: window.__painter.brushColorHSVA[3],
      strokeAlpha: window.__painter._strokeColor().alpha,
    }));
    assert.equal(adhocAlpha.adhoc, 'black', 'alpha changes preserve the ad-hoc colour');
    assert.equal(adhocAlpha.alpha, 0.35, 'iro alpha reaches the saved alpha channel');
    assert.ok(adhocAlpha.strokeAlpha < beforeAdhocAlpha, 'iro alpha changes deposited opacity');
    assert.equal(await page.locator('#paint-color-alpha').textContent(), '59',
      'alpha readout uses a two-character hex channel');
    await page.locator('.IroWheel .IroHandle--0').dispatchEvent('pointerdown', {
      pointerId: 77, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    });
    assert.equal(await page.evaluate(() => window.__painter.adhocPaintColor), null,
      'touching the iro handle restores the saved wheel colour');
    const hsvaAfterAlpha = originalHsva.slice();
    hsvaAfterAlpha[3] = 0.35;
    assert.deepEqual(await page.evaluate(() => window.__painter.brushColorHSVA.slice()), hsvaAfterAlpha,
      'restoring the wheel colour preserves its original HSVA');

    await page.click('#paint-color-white');
    assert.equal(await page.locator('#paint-color-white').getAttribute('aria-pressed'), 'true',
      'White exposes its selected state');
    assert.deepEqual(await page.evaluate(() => window.__painter._strokeColor().channels), [0, 0, 0],
      'ad-hoc white uses the exact no-pigment corner');
    assert.equal(await page.locator('.IroWheel .IroHandle--0 circle:last-child').evaluate(
      (circle) => getComputedStyle(circle).fill
    ), 'rgb(255, 255, 255)', 'ad-hoc white paints the iro handle white');
    await page.locator('.IroWheel .IroHandle--0').dispatchEvent('pointerdown', {
      pointerId: 78, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    });

    await page.click('#panel-extension-toggle');
    await page.click('#panel-extension-grip');
    assert.equal(await page.locator('#panel-extension').getAttribute('data-collapsed'), 'true',
      'extension grip tap collapses the extension');
    assert.equal(await page.locator('#story-file-tab').isVisible(), true,
      'File/Player tabs remain in an empty collapsed header');
    assert.equal(await page.locator('#story-header-play-pause').isHidden(), true,
      'header playback stays hidden before a Story is loaded');
    await page.click('#panel-extension-grip');
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
    const optionStyle = await page.locator('#story-speed option').first().evaluate((option) => {
      const style = getComputedStyle(option);
      return { color: style.color, backgroundColor: style.backgroundColor };
    });
    assert.deepEqual(optionStyle, {
      color: 'rgb(17, 17, 17)', backgroundColor: 'rgb(255, 255, 255)',
    }, 'native speed options use readable dark-on-white colours');

    await page.setInputFiles('#story-file-input', pngFixture);
    await page.waitForFunction(() => window.__painter.storyPlaybackController.backgroundSummary);
    assert.equal(await page.evaluate(() => window.__painter.engine.renderer.hasBackground), true,
      'PNG upload reaches the renderer background layer');
    assert.equal(await page.evaluate(() => {
      const painter = window.__painter;
      const pixels = painter.engine.exportPixels({
        width: 64, height: 64, resolutionScale: 1, colorModel: painter.colorModel,
      });
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 250 || pixels[index + 1] < 250 || pixels[index + 2] < 250) return true;
      }
      return false;
    }), true, 'saved output includes visible PNG background pixels');
    assert.equal(await page.locator('#story-background-card').getAttribute('hidden'), null,
      'loaded PNG is represented in the File tab');
    assert.ok(await page.locator('#story-background-name').textContent(), 'background filename is shown');

    await page.evaluate(() => {
      const painter = window.__painter;
      painter.__storyPointerTargetLeaks = 0;
      const advance = painter.engine.advance.bind(painter.engine);
      painter.engine.advance = (now, target) => {
        if (painter.storyPlaybackController.state === 'playing' && target) {
          painter.__storyPointerTargetLeaks++;
        }
        return advance(now, target);
      };
    });
    await page.click('#story-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.progress.paintedOperations > 2);
    assert.equal(await page.evaluate(() => window.__painter.__storyPointerTargetLeaks), 0,
      'manual pointer targets never leak into Story-owned brush updates');
    assert.equal(await page.locator('#story-player-gaps').isHidden(), true,
      'remaining-ranges callout stays hidden during playback');
    assert.equal(await page.locator('#story-stop-decision').isHidden(), true,
      'result-decision callout stays hidden during playback');
    const panelBeforeExtensionDrag = await page.locator('#ui').boundingBox();
    const extensionGrip = await page.locator('#panel-extension-grip').boundingBox();
    await page.mouse.move(extensionGrip.x + extensionGrip.width / 2, extensionGrip.y + extensionGrip.height / 2);
    await page.mouse.down();
    await page.mouse.move(extensionGrip.x + extensionGrip.width / 2 + 24,
      extensionGrip.y + extensionGrip.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    const panelAfterExtensionDrag = await page.locator('#ui').boundingBox();
    assert.ok(Math.abs(panelAfterExtensionDrag.x - panelBeforeExtensionDrag.x) > 10,
      'dragging the extension grip moves the attached panel group');
    assert.equal(await page.locator('#panel-extension').getAttribute('data-collapsed'), 'false',
      'an extension drag does not collapse it');
    await page.click('#panel-extension-grip');
    assert.equal(await page.locator('#story-header-play-pause').isVisible(), true,
      'collapsed loaded Story keeps Play/Pause in the header');
    assert.equal(await page.evaluate(() => window.__painter.storyPlaybackController.state), 'playing',
      'collapsing the extension does not pause playback');
    await page.click('#story-header-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'paused');
    await page.click('#story-header-play-pause');
    await page.waitForFunction(() => window.__painter.storyPlaybackController.state === 'playing');
    await page.click('#panel-extension-grip');
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

    await page.click('#story-file-tab');
    await page.click('#story-remove-background');
    await page.waitForFunction(() => !window.__painter.storyPlaybackController.backgroundSummary);
    assert.equal(await page.evaluate(() => window.__painter.engine.renderer.hasBackground), false,
      'Remove background restores the plain canvas renderer');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const extension = document.getElementById('panel-extension').getBoundingClientRect();
      return extension.left >= 0 && extension.right <= window.innerWidth;
    });
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
