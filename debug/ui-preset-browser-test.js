'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Fluid UI preset');

const root = path.resolve(__dirname, '..', process.env.FLUID_UI_TEST_DIST ? 'dist' : '.');
const evidence = process.env.FLUID_UI_EVIDENCE_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fluid-MU-1-'));
fs.mkdirSync(evidence, { recursive: true });
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
    await page.waitForFunction(() => window.__painter?.storyPlaybackController && window.__fluidUiPresetApi);
    assert.equal(await page.locator('#ui').isVisible(), true, 'full is the default');
    assert.deepEqual(await page.evaluate(() => window.__fluidUiPresetApi.getResolvedFeatures()), [
      'color-picker', 'brush-size', 'colors-options', 'brush-options', 'player', 'demo-r2', 'file-bg', 'file-play', 'state-bake',
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
    await page.waitForFunction(() => window.__painter?.storyPlaybackController && window.__fluidUiPresetApi);
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
    await page.waitForFunction(() => window.__painter?.storyPlaybackController && window.__fluidUiPresetApi);
    assert.equal(await page.locator('#ui').isVisible(), true);
    assert.equal(await page.locator('#bar-size-slider').isVisible(), true);
    assert.equal(await page.locator('#bar-hue-stripe').isVisible(), true);
    assert.equal(await page.locator('#panel-extension-toggle').isVisible(), false);
    assert.equal(await page.locator('#story-demo-tab').isVisible(), false);
    assert.equal(await page.locator('#fluidity-slider').isVisible(), false);

    await page.goto(`${base}&uiMode=preset&uiPreset=draw-min&uiFeatures=brush-options,state-bake`);
    await page.waitForFunction(() => window.__painter?.storyPlaybackController && window.__fluidUiPresetApi);
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
      await page.locator('#bristle-shapes div').evaluateAll((els) => els.map((el) => el.title)),
      ['Round', 'Tri', 'Quad', 'Pent', 'Hex', 'Slash']);
    assert.equal(
      await page.locator('#bristle-shapes .button-selected').evaluate((el) => el.title), 'Round',
      'the round default is selected on load');
    assert.equal(await page.evaluate(() => window.__painter.brushShape), null,
      'and Round means no footprint at all, not a 0-sided one');

    // The control must actually reach the stroke: select Hex, then confirm the
    // footprint the engine is handed. A control that only moved its highlight
    // would pass every visibility check above.
    const strokeShape = await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll('#bristle-shapes div')];
      buttons.find((button) => button.title === 'Hex')
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
    assert.deepEqual(strokeShape.state, { sides: 6, rotation: Math.PI / 2 });
    assert.deepEqual(strokeShape.passedToEngine, [{ sides: 6, rotation: Math.PI / 2 }],
      'the selected footprint reaches beginStroke()');

    await page.goto(`${base}&uiMode=preset&uiPreset=draw-min`);
    await page.waitForFunction(() => window.__painter?.storyPlaybackController && window.__fluidUiPresetApi);
    await page.evaluate(() => { window.__presetTestCanvas = document.querySelector('#canvas-cell canvas'); });
    await page.evaluate(() => window.__fluidUiPresetApi.configure({ mode: 'features', features: ['player'] }));
    assert.equal(await page.locator('#panel-extension-toggle').isVisible(), true);
    assert.equal(await page.locator('#bar-size-slider').isVisible(), false);
    await page.click('#panel-extension-toggle');
    assert.equal(await page.locator('#story-player-page').isVisible(), true);
    assert.equal(await page.locator('#story-demo-tab').isVisible(), false);
    await page.evaluate(() => window.__fluidUiPresetApi.configure({ mode: 'features', features: ['player', 'demo-r2'] }));
    assert.equal(await page.locator('#story-demo-tab').isVisible(), true);
    await page.evaluate(() => window.__fluidUiPresetApi.configure({ mode: 'features', features: ['player'] }));
    assert.equal(await page.locator('#story-demo-tab').isVisible(), false);
    assert.equal(await page.locator('#panel-extension').evaluate((element) => element.inert), false);
    assert.equal(await page.evaluate(() => document.querySelector('#canvas-cell canvas') === window.__presetTestCanvas), true,
      'runtime layout changes preserve the rendering canvas');

    await page.goto(`${base}&uiMode=features&uiFeatures=demo-r2`);
    assert.match(await page.locator('#fluid-ui-config-error').textContent(), /UI_FEATURE_DEPENDENCY/);

    await page.close();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    const mobile = await context.newPage();
    const errors = [];
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.goto(`${base}&uiMode=empty`);
    await mobile.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    const settle = () => mobile.waitForTimeout(200);
    const measure = () => mobile.evaluate(() => {
      const panel = document.querySelector('#ui');
      const bar = document.querySelector('#panel-bar');
      const body = document.querySelector('#panel-body');
      return {
        panel: panel.getBoundingClientRect().toJSON(), bar: bar.getBoundingClientRect().toJSON(),
        grip: document.querySelector('#panel-grip').getBoundingClientRect().toJSON(),
        direction: panel.dataset.bodyPlacement, collapsed: panel.dataset.collapsed,
        arrow: getComputedStyle(document.querySelector('#panel-grip'), '::after').transform,
        expanded: document.querySelector('#panel-grip').getAttribute('aria-expanded'),
        pickerWidth: window.__painter.colorControl.picker.state.width,
        overflow: getComputedStyle(body).overflowY,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      };
    });
    // The top/right CSS borders meet at (1, -1). Check their transformed
    // tip, not just equality between matrices: inverted arrows also satisfy
    // the old pairwise checks for all four states.
    const assertChevron = (sample) => {
      const matrix = sample.arrow.match(/^matrix\(([^)]+)\)$/);
      assert.ok(matrix, 'chevron has a resolved 2D transform');
      const [, b, , d] = matrix[1].split(',').map(Number);
      const tipY = b - d;
      const opensUp = sample.direction === 'above';
      const pointsUp = sample.collapsed === 'true' ? opensUp : !opensUp;
      assert.ok(pointsUp ? tipY < -1 : tipY > 1,
        `${sample.direction}/${sample.collapsed}: chevron must point ${pointsUp ? 'up' : 'down'}, got ${sample.arrow}`);
    };
    const configure = (config) => mobile.evaluate((value) => window.__fluidUiPresetApi.configure(value), config);
    const tools = { mode: 'preset', preset: 'draw-full', features: ['state-bake'] };
    assert.equal(await mobile.evaluate(() => window.__painter.toolPanel._desiredAnchor), null,
      'hidden constructor does not clamp zero-size UI into x=56');
    assert.equal(await mobile.locator('#panel-return').isVisible(), false, 'initial empty has nothing to restore');
    await configure(tools);
    await settle();
    const initial = await measure();
    assert.ok(Math.abs(initial.panel.left - 12) <= 1);
    assert.ok(Math.abs(initial.bar.bottom - (844 - 13)) <= 1, 'restricted initial bar at lower safe edge');
    assert.equal(initial.direction, 'above', 'collapsed bar knows its opening direction');
    assert.ok(initial.grip.width >= 44 && initial.grip.height >= 44);
    assert.equal(await mobile.locator('#panel-grip svg').count(), 1);
    assert.equal(await mobile.locator('#panel-grip span').count(), 0);
    const results = { initial, cycles: [], synchronous: {}, hiddenRepeats: [], input: {}, viewports: [] };

    for (const [name, top] of [['top', 24], ['bottom', 720]]) {
      await mobile.evaluate((y) => {
        window.__painter.toolPanel.moveTo(12, y);
        window.__painter.toolPanel.setCollapsed(true);
      }, top);
      await settle();
      const baseline = await measure();
      results.synchronous[name] = await mobile.evaluate(() => {
        const panel = window.__painter.toolPanel;
        const before = panel._barTop();
        for (let i = 0; i < 20; i++) { panel.setCollapsed(false); panel.setCollapsed(true); }
        panel.setCollapsed(true);
        panel.clampIntoView();
        panel.clampIntoView();
        return { before, after: panel._barTop() };
      });
      assert.ok(Math.abs(results.synchronous[name].after - baseline.bar.top) <= 1,
        'synchronous negative control and repeated clamp are stable but do not replace settled clicks');
      for (let cycle = 0; cycle < 20; cycle++) {
        for (const collapsed of [false, true]) {
          await mobile.tap('#panel-grip');
          await settle();
          const sample = await measure();
          assert.equal(sample.collapsed, String(collapsed), 'trusted tap toggles exactly once');
          assert.equal(sample.expanded, String(!collapsed));
          assert.equal(sample.direction, name === 'top' ? 'below' : 'above');
          assert.ok(Math.abs(sample.bar.top - baseline.bar.top) <= 1,
            `${name} settled cycle ${cycle}: ${sample.bar.top} vs ${baseline.bar.top}`);
          if (collapsed) assert.equal(sample.pickerWidth, results.cycles.at(-1).pickerWidth,
            'hidden picker retains its last visible width instead of resizing to 200');
          results.cycles.push({ name, cycle, ...sample });
        }
      }
      console.log(`MU-1: ${name} 20 settled touch cycles PASS`);
    }
    for (const sample of [initial, ...results.cycles]) assertChevron(sample);
    const arrows = results.cycles.slice(0, 2).concat(results.cycles.slice(40, 42));
    assert.equal(arrows[0].arrow, arrows[3].arrow, 'top expanded and bottom collapsed point up');
    assert.equal(arrows[1].arrow, arrows[2].arrow, 'top collapsed and bottom expanded point down');
    assert.notEqual(arrows[0].arrow, arrows[1].arrow);

    await mobile.locator('#panel-grip').focus();
    await mobile.keyboard.press('Enter');
    await settle();
    assert.equal((await measure()).collapsed, 'false', 'Enter toggles once');
    await mobile.keyboard.press('Space');
    await settle();
    assert.equal((await measure()).collapsed, 'true', 'Space toggles once');
    results.input.keyboard = 'PASS';
    for (const type of ['pointercancel', 'lostpointercapture']) {
      await mobile.evaluate((endType) => {
        const grip = document.querySelector('#panel-grip');
        grip.dispatchEvent(new PointerEvent('pointerdown', {
          pointerId: 555, pointerType: 'touch', isPrimary: true, button: 0,
        }));
        grip.dispatchEvent(new PointerEvent(endType, { pointerId: 555, pointerType: 'touch' }));
      }, type);
      assert.equal((await measure()).collapsed, 'true', `${type} is not a tap`);
    }
    await mobile.evaluate(() => {
      const grip = document.querySelector('#panel-grip');
      grip.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 556, pointerType: 'touch', isPrimary: false, button: 0,
      }));
      grip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 556, pointerType: 'touch' }));
    });
    assert.equal((await measure()).collapsed, 'true', 'secondary contact cannot toggle or own a drag');
    results.input.syntheticCancelAndSecondary = 'PASS';

    const beforeDrag = await measure();
    const input = await context.newCDPSession(mobile);
    const x = beforeDrag.grip.x + beforeDrag.grip.width / 2;
    const y = beforeDrag.grip.y + beforeDrag.grip.height / 2;
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await input.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: y - step * 100 }],
      });
    }
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle();
    const afterDrag = await measure();
    assert.ok(beforeDrag.bar.top - afterDrag.bar.top >= 110, 'trusted touch drag moves the panel');
    assert.equal(afterDrag.collapsed, 'true', 'drag is not also a disclosure tap');
    assert.equal(afterDrag.direction, 'below', 'cross-midpoint drag updates direction before disclosure');
    assertChevron(afterDrag);
    assert.equal(await mobile.evaluate(() => window.__painter.engine.strokeActive), false,
      'grip drag never paints');
    results.input.trustedTouchDrag = { before: beforeDrag.bar.top, after: afterDrag.bar.top };
    await mobile.tap('#panel-return');
    await settle();
    assert.equal(await mobile.locator('#panel-return').isVisible(), false,
      'first touch immediately after drag restores the bottom without a compatibility click');
    await mobile.evaluate((top) => window.__painter.toolPanel.moveTo(12, top), afterDrag.bar.top);
    await settle();

    for (let i = 0; i < 10; i++) {
      await configure({ mode: 'empty' });
      await settle();
      assert.equal(await mobile.locator('#panel-return').isVisible(), true);
      await configure(tools);
      await settle();
      const sample = await measure();
      assert.ok(Math.abs(sample.bar.top - afterDrag.bar.top) <= 1, 'Tools hide/show preserves user anchor');
      results.hiddenRepeats.push(sample.bar.top);
    }
    await configure({ mode: 'empty' });
    await settle();
    await mobile.evaluate(() => {
      window.__mu1UiEvents = [];
      window.__fluidUiPresetApi.subscribe((state) => window.__mu1UiEvents.push(state.config));
    });
    await mobile.locator('#panel-return').focus();
    await mobile.keyboard.press('Space');
    await settle();
    const recovered = await measure();
    assert.ok(Math.abs(recovered.bar.bottom - (844 - 13)) <= 1, 'return restores bottom anchor');
    assert.deepEqual(await mobile.evaluate(() => window.__fluidUiPresetApi.getConfig()), { version: 1, ...tools });
    assert.equal(await mobile.evaluate(() => window.__mu1UiEvents.length), 1,
      'return uses canonical UI API and notifies existing subscribers');
    assert.equal(await mobile.locator('#panel-return').isVisible(), false, 'recovery icon does not occlude bottom tools');
    results.recovered = recovered;
    await configure({ mode: 'empty' });
    await settle();
    await mobile.tap('#panel-return');
    await settle();
    assert.equal(await mobile.locator('#ui').isVisible(), true, 'touch recovery restores hidden tools');
    assert.equal(await mobile.locator('#panel-extension').isVisible(), false,
      'recovery compatibility click cannot activate the extension underneath');

    await mobile.tap('#panel-grip');
    await settle();
    assert.equal((await measure()).collapsed, 'false', 'a touch after return expands the body');
    const reflowTop = (await measure()).bar.top;
    await mobile.evaluate(() => { document.querySelector('#ui').style.width = '300px'; });
    await settle();
    assert.ok(Math.abs((await measure()).bar.top - reflowTop) <= 1, 'picker width reflow preserves bar');
    await mobile.evaluate(() => { document.querySelector('#ui').style.removeProperty('width'); });
    await settle();
    assert.ok(Math.abs((await measure()).bar.top - reflowTop) <= 1);
    await mobile.screenshot({ path: path.join(evidence, 'mobile-bottom-expanded.png') });

    for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await mobile.setViewportSize(viewport);
      await settle();
      const sample = await measure();
      assert.ok(sample.grip.left >= 12 && sample.grip.right <= viewport.width - 12 + 1);
      assert.ok(sample.panel.top >= 12 - 1 && sample.panel.bottom <= viewport.height - 12 + 1);
      assert.ok(Math.abs(sample.bar.bottom - (viewport.height - 13)) <= 1, 'bottom dock follows rotation');
      if (sample.scrollHeight > sample.clientHeight + 1) assert.equal(sample.overflow, 'auto');
      results.viewports.push({ ...viewport, ...sample });
    }
    await mobile.screenshot({ path: path.join(evidence, 'mobile-rotated-back.png') });
    await context.close();

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await desktop.goto(base);
    await desktop.waitForFunction(() => window.__painter && window.__fluidUiPresetApi);
    await desktop.evaluate(() => window.__painter.toolPanel.moveTo(-160, 240));
    await desktop.waitForTimeout(200);
    const partial = await desktop.evaluate(() => ({
      panel: document.querySelector('#ui').getBoundingClientRect().toJSON(),
      grip: document.querySelector('#panel-grip').getBoundingClientRect().toJSON(),
    }));
    assert.ok(partial.panel.left < 0, 'desktop deliberate partial offscreen drag remains allowed');
    assert.ok(partial.grip.left >= 12 && partial.grip.right <= 1280 - 12);
    results.desktopPartial = partial;
    await desktop.locator('#panel-return').click();
    await desktop.waitForTimeout(200);
    await desktop.screenshot({ path: path.join(evidence, 'desktop-return.png') });
    await desktop.close();
    assert.deepEqual(errors, [], 'mobile scenarios have no uncaught page errors');
    results.provenance = {
      root, browser: browser.version(), input: 'Chromium touch emulation; CDP touch drag; synthetic cancel/capture/secondary checks',
      physicalMobile: false, dpr: 2, cycleCount: results.cycles.length / 2,
    };
    fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`MU-1: ${results.cycles.length / 2} settled cycles; 10 Tools repeats; keyboard/touch/cancel/reflow/rotation/return/desktop PASS`);
    console.log(`MU-1 evidence: ${evidence}`);
    console.log('Fluid UI preset browser: PASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
