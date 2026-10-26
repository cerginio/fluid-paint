'use strict';

// fluid-session phase 3: the State tab's Session recording card, end to end in
// the real page (SwiftShader). Record -> real mouse strokes + Undo -> close the
// panel (recording continues, chip visible) -> Stop -> Save -> the downloaded
// .flus decodes to what was painted. Also the unsaved guard, beforeunload,
// Resize ending a recording, Open…, the 320 px layout and recorder overhead.
//
// Phase 4: Open in Player and AC-REC-5 through the UI. Three recordings --
// from an empty canvas with an Undo, over a painting (baseline PNG), and one
// with every command -- each settle, are exported, then replayed on a fresh
// page (a reload: new Math.random, new engine) via Open… -> Open in Player ->
// Play. The first replays at 1x, pauses mid-run and finishes at Max; one runs
// in a smaller window, where the view must zoom out to show the painting.
//
//   node debug/session-recording-ui-test.js              SwiftShader
//   node debug/session-recording-ui-test.js --hardware   real GPU (ANGLE D3D11)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Session recording UI');

const hardware = process.argv.includes('--hardware');
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

const frames = (page, count) => page.evaluate((n) => new Promise((resolve) => {
  let left = n;
  const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), count);

// The painting as exportPixels() reads it, base64: what AC-REC-5 compares.
const exportPixels = (page) => page.evaluate(() => {
  const painter = window.__painter;
  const pixels = painter.engine.exportPixels({
    width: painter.paintingRectangle.width, height: painter.paintingRectangle.height,
    resolutionScale: painter.resolutionScale,
  });
  let binary = '';
  for (let i = 0; i < pixels.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, pixels.subarray(i, i + 0x8000));
  }
  return btoa(binary);
});

function comparePixels(original, replayed) {
  const a = Buffer.from(original, 'base64');
  const b = Buffer.from(replayed, 'base64');
  assert.equal(a.length, b.length, 'the replay exports the same painting size');
  let identical = 0;
  let withinTwo = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixelMax = 0;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      if (delta === 0) identical++;
      if (delta > pixelMax) pixelMax = delta;
    }
    if (pixelMax <= 2) withinTwo++;
    if (pixelMax > maxDelta) maxDelta = pixelMax;
  }
  const painted = a.some((value, i) => i % 4 !== 3 && value !== 255);
  return { identicalBytes: identical / a.length, withinTwo: withinTwo / (a.length / 4), maxDelta, painted };
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: hardware
    ? ['--use-angle=d3d11', '--renderer-process-limit=1']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'] });
  const checks = [];
  const check = (name) => { checks.push(name); console.log(`ok - ${name}`); };
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1,
      acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The Demo tab's remote catalog is unreachable from 127.0.0.1 (CORS); that
    // is the environment, not the recording.
    page.on('console', (message) => {
      if (message.type() === 'error' && !/fluid-demo|Failed to load resource/.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none`);
    await page.waitForFunction(() => window.__painter && window.__painter.sessionTools);

    const status = () => page.locator('#session-status-text').textContent();
    const openState = async () => {
      if (await page.locator('#panel-extension').isHidden()) await page.click('#panel-extension-toggle');
      await page.click('#bake-tab');
    };
    // A real mouse stroke inside the painting, away from the panels.
    const stroke = async (from, to) => {
      const box = await page.evaluate(() => {
        const rect = window.__painter.canvas.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      });
      const at = (u, v) => ({ x: box.x + box.width * u, y: box.y + box.height * v });
      const a = at(...from);
      const b = at(...to);
      const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, a);
      assert.equal(target, 'CANVAS', `stroke starts on the canvas at ${JSON.stringify(from)}`);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12);
        await frames(page, 1);
      }
      await page.mouse.up();
      await frames(page, 2);
    };

    // --- Card in its idle state ---------------------------------------------
    await openState();
    assert.equal(await page.evaluate(() => document.querySelector('#bake-page').firstElementChild.id), 'session-card',
      'Session recording is the first card in State');
    assert.equal(await status(), 'Not recording');
    assert.equal(await page.locator('#session-save').isDisabled(), true);
    assert.equal(await page.locator('#session-open').isEnabled(), true);
    assert.equal(await page.locator('#session-rec-chip').isHidden(), true);
    assert.equal(await page.locator('#session-start-from').isHidden(), true, 'empty canvas: no Starts from');
    check('idle card: first in State, Not recording, Save disabled, no chip');

    // --- Record, paint, undo, close the panel, paint again --------------------
    await page.click('#session-record');
    assert.match(await status(), /^● REC 00:0\d · 0 strokes · ~1 KB$/);
    assert.equal(await page.locator('#session-record').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#session-record').textContent(), '■ Stop');
    assert.equal(await page.locator('#session-open').isDisabled(), true);
    assert.equal(await page.locator('#session-rec-chip').isVisible(), true);
    check('Record: status ● REC, aria-pressed, Open disabled, chip visible');

    await page.click('#panel-extension-close');
    await stroke([0.35, 0.4], [0.6, 0.45]);
    await stroke([0.4, 0.6], [0.55, 0.3]);
    await stroke([0.3, 0.5], [0.65, 0.55]);
    await page.keyboard.press('KeyZ');
    await frames(page, 3);
    assert.equal(await page.locator('#session-rec-chip').isVisible(), true, 'chip stays with the panel closed');
    assert.equal(await page.evaluate(() => window.__painter.sessionRecorder.state), 'recording');
    await stroke([0.45, 0.35], [0.5, 0.65]);
    await page.click('#session-rec-chip');
    assert.equal(await page.locator('#bake-page').isVisible(), true, 'the chip opens the State tab');
    assert.match(await status(), /^● REC 00:\d\d · 4 strokes · ~\d+ KB$/);
    check('closing the panel does not stop the recording; the chip reopens State');

    // --- Stop: recorded, not saved ---------------------------------------------
    // Let the fluid settle first: what the canvas shows after Stop is then
    // exactly what the recording ends on, and AC-REC-5 compares against it.
    await frames(page, 70);
    await page.click('#session-record');
    await page.waitForFunction(() => window.__painter.sessionTools.phase === 'recorded');
    const originals = { empty: await exportPixels(page) };
    assert.match(await status(), /^Recorded 00:\d\d · 4 strokes · \d+ KB — not saved$/);
    assert.equal(await page.locator('#session-save').isEnabled(), true);
    assert.equal(await page.locator('#session-rec-chip').isHidden(), true);
    assert.equal(await page.locator('#session-start-from').isVisible(), true, 'painted canvas: Starts from offered');
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true, 'beforeunload warns about the unsaved recording');
    check('Stop: Recorded … — not saved, Save enabled, beforeunload armed');

    // --- Unsaved guard ---------------------------------------------------------
    await page.click('#session-record');
    assert.equal(await page.locator('#session-discard').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__painter.sessionRecorder.state), 'stopped', 'not started yet');
    await page.click('#session-discard-cancel');
    assert.equal(await page.locator('#session-discard').isHidden(), true);
    assert.match(await status(), /not saved$/);
    await page.click('#session-open');
    assert.equal(await page.locator('#session-discard').isVisible(), true, 'Open… warns too');
    await page.click('#session-discard-cancel');
    check('unsaved guard: Record and Open… warn inline; Cancel keeps the recording');

    // --- Save -------------------------------------------------------------------
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#session-save')]);
    assert.match(download.suggestedFilename(), /^painting-session-\d{8}-\d{4}\.flus$/);
    const savedPath = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'flus-')), download.suggestedFilename());
    await download.saveAs(savedPath);
    const bytes = fs.readFileSync(savedPath);
    assert.equal(await status(), `Saved ${download.suggestedFilename()}`);
    const decoded = await page.evaluate(async (data) => {
      const session = await SessionCodec.decode(new Uint8Array(data));
      const kinds = {};
      for (const record of session.records) {
        const kind = record.type === 'command' ? record.command.op : record.type;
        kinds[kind] = (kinds[kind] || 0) + 1;
      }
      const ticks = session.records.filter((r) => r.type === 'ticks').reduce((sum, r) => sum + r.data.length / 3, 0);
      return { header: session.header, kinds, ticks, baseline: !!session.baselinePng };
    }, [...bytes]);
    assert.equal(decoded.kinds.begin, 4);
    assert.equal(decoded.kinds.end, 4);
    assert.equal(decoded.kinds.undo, 1);
    assert.equal(decoded.kinds.snapshot, 4, 'one undo snapshot per stroke');
    assert.equal(decoded.ticks, decoded.header.stats.ticks);
    assert.ok(decoded.ticks > 20, 'the strokes produced ticks');
    assert.equal(decoded.baseline, false, 'recorded on an empty canvas');
    assert.equal(decoded.header.baseline, 'empty');
    assert.equal(decoded.header.engineContract, 1);
    assert.ok(Number.isInteger(decoded.header.bristleSeed));
    assert.ok(bytes.length / decoded.ticks <= 300 * 1024 / 36000 + 40, 'size in the right range');
    console.log(JSON.stringify({ check: 'saved file', bytes: bytes.length, ...decoded }));
    check('Save downloads painting-session-*.flus that decodes to 4 strokes, the undo and the ticks');

    // --- Saved: Record starts directly; over a painting, with a baseline ------
    await page.click('#session-record');
    assert.equal(await page.locator('#session-discard').isHidden(), true, 'a saved session needs no warning');
    await page.waitForFunction(() => window.__painter.sessionRecorder.state === 'recording');
    assert.match(await page.locator('#session-note').textContent(), /flat background/);
    assert.equal(await page.evaluate(() => window.__painter.canUndo()), false, 'undo history starts at Record');
    // Phase 4: the replay starts from a flat background, so the live session
    // does too -- the painting is baked at Record, wet paint and velocity gone.
    assert.deepEqual(await page.evaluate(() => {
      const engine = window.__painter.engine;
      const wet = engine.readPaintTexture().pixels.some((value) => value !== 0);
      return { background: engine.renderer.hasBackground, wet, splatAreas: engine.simulator.splatAreas.length };
    }), { background: true, wet: false, splatAreas: 0 });
    check('Record over a painting: baseline note, undo history starts over, painting baked dry');

    await page.click('#panel-extension-close');
    await stroke([0.3, 0.3], [0.7, 0.6]);
    await frames(page, 70);
    originals.baseline = await exportPixels(page);

    // --- Resize ends the recording, keeping it -----------------------------------
    await page.evaluate(() => {
      const painter = window.__painter;
      // What onGestureEnd does on release of a right-edge drag.
      painter.resizingSide = ResizingSide.RIGHT;
      painter.newPaintingRectangle = painter.paintingRectangle.clone();
      painter.newPaintingRectangle.width -= 40;
      painter._commitResize();
    });
    await page.waitForFunction(() => window.__painter.sessionTools.phase === 'recorded');
    await openState();
    assert.match(await page.locator('#session-note').textContent(), /painting was resized/);
    const resized = await page.evaluate(async () => {
      const session = await SessionCodec.decode(window.__painter.sessionTools.file.bytes);
      return { baseline: session.header.baseline, png: session.baselinePng && session.baselinePng.length,
        stopReason: session.header.stopReason, strokes: session.header.stats.strokes };
    });
    assert.deepEqual({ baseline: resized.baseline, stopReason: resized.stopReason, strokes: resized.strokes },
      { baseline: 'png', stopReason: 'resize', strokes: 1 });
    assert.ok(resized.png > 100, 'baseline PNG embedded');
    const baselineFile = Buffer.from(await page.evaluate(() => [...window.__painter.sessionTools.file.bytes]));
    check('Resize stops the recording and keeps it; the file carries a baseline PNG');

    // --- Open… ----------------------------------------------------------------
    await page.click('#session-open');
    await page.click('#session-discard-confirm');
    // Discard ran the held action: the file chooser opens through the input.
    await page.setInputFiles('#session-open-input', savedPath);
    await page.waitForFunction(() => !document.getElementById('session-opened').hidden &&
      document.getElementById('session-opened').textContent.includes('Exact'));
    const opened = await page.locator('#session-opened').textContent();
    assert.match(opened, /4 strokes · .* ticks · \d+ KB · Exact · starts from an empty canvas\.$/);
    assert.equal(await status(), 'Not recording', 'Discard dropped the unsaved recording');
    assert.equal(await page.locator('#session-open-player').isVisible(), true, 'an Exact file offers Open in Player');
    const junk = path.join(path.dirname(savedPath), 'junk.flus');
    fs.writeFileSync(junk, 'not a session');
    await page.setInputFiles('#session-open-input', junk);
    await page.waitForFunction(() => document.getElementById('session-opened').classList.contains('is-error'));
    assert.match(await page.locator('#session-opened').textContent(), /not a Fluid Paint session/);
    assert.equal(await page.locator('#session-open-player').isHidden(), true, 'a damaged file offers nothing to play');
    check('Open… summarises a saved file as Exact with Open in Player, and names a damaged one');

    // --- Record follows story playback ------------------------------------------
    await page.evaluate(async () => {
      const controller = window.__painter.storyPlaybackController;
      const story = await fetch('docs/story-2026-09-08-4-frames.json').then((response) => response.json());
      await controller.loadModel(story);
      controller.setSpeed(1);
      window.__storyRun = controller.play();
    });
    await page.waitForFunction(() => document.getElementById('session-record').disabled);
    assert.match(await page.locator('#session-record').getAttribute('title'), /Stop story playback first/);
    await page.evaluate(() => window.__painter.storyPlaybackController.stop());
    await page.waitForFunction(() => !document.getElementById('session-record').disabled);
    check('Record is disabled while a story plays, and comes back when it stops');

    // --- Recorder overhead (AC-REC-7) -------------------------------------------
    const overhead = await page.evaluate(() => {
      // A detached recorder in the recording state: the same per-tick code.
      const recorder = new SessionRecorder(window.__painter.engine, { now: () => 0 });
      recorder.state = 'recording';
      recorder._lastFluidity = window.__painter.engine.fluidity;
      const observer = recorder._observer;
      observer.onBeginStroke({ timing: 'live', x: 1, y: 1, brushSize: 40 }, 0.5);
      const n = 200000;
      const start = performance.now();
      for (let i = 0; i < n; i++) observer.onTick(100 + i * 0.01, 200, 12, 40);
      const tickMs = (performance.now() - start) / n;
      return { tickMicroseconds: Math.round(tickMs * 1e5) / 100, fiveTicksPerFrameMs: tickMs * 5 };
    });
    console.log(JSON.stringify({ check: 'overhead', ...overhead }));
    assert.ok(overhead.fiveTicksPerFrameMs < 0.1, 'five recorded ticks cost < 0.1 ms');
    check('recorder overhead: five ticks per frame well under 0.1 ms');

    // --- Phase 4: a recording with every command (AC-REC-4 on replay) ------------
    await openState();
    await page.check('#session-start-from input[value="clear"]');
    // Paint still flowing when Record is pressed, and the first recorded
    // stroke lands in it before any host frame: Clear keeps the velocity, which
    // is in no file, so Record must drop it as the replay does. One evaluate,
    // so no RAF lets the fluid settle in between.
    await page.evaluate(async () => {
      const painter = window.__painter;
      const engine = painter.engine;
      const r = painter.paintingRectangle;
      const at = (u) => ({ x: r.left + r.width * u, y: r.bottom + r.height * 0.5, pressure: 0.8 });
      const stroke = (from, channels) => {
        engine.beginStroke({ timing: 'live', paintingRectangle: r, resolutionScale: painter.resolutionScale,
          ...at(from), brushSize: 40, color: { space: 'pigment', channels, alpha: 0.8 } });
        for (let i = 1; i <= 10; i++) { engine.strokeTo(at(from + 0.04 * i)); engine.stepTick(); }
        engine.endStroke();
      };
      stroke(0.3, [1, 0, 0]);
      document.getElementById('session-record').click();
      for (let i = 0; painter.sessionRecorder.state !== 'recording'; i++) {
        if (i > 1000) throw new Error('Record did not start without a frame.');
        await Promise.resolve();
      }
      stroke(0.35, [0, 0, 1]);
    });
    await page.click('#panel-extension-close');
    await stroke([0.3, 0.35], [0.6, 0.4]);
    await page.evaluate(() => window.__painter.setPaletteMode('digital'));
    await stroke([0.35, 0.6], [0.65, 0.5]);
    await page.evaluate(async () => { await window.__painter.undo(); await window.__painter.redo(); });
    await page.evaluate(() => {
      const painter = window.__painter;
      // QUALITIES is a top-level const of paint-setup.js: by name, not on window.
      const lower = QUALITIES.map((q) => q.resolutionScale).filter((s) => s < painter.resolutionScale);
      painter.setResolutionScale(lower.length ? Math.max(...lower) : QUALITIES[0].resolutionScale);
    });
    await stroke([0.4, 0.3], [0.45, 0.7]);
    await page.evaluate(() => window.__painter.bakeToBackground());
    await stroke([0.3, 0.45], [0.7, 0.45]);
    await page.evaluate(() => window.__painter.clear());
    await stroke([0.5, 0.3], [0.55, 0.65]);
    await frames(page, 70);
    await openState();
    await page.click('#session-record');
    await page.waitForFunction(() => window.__painter.sessionTools.phase === 'recorded');
    originals.commands = await exportPixels(page);
    const commandsFile = Buffer.from(await page.evaluate(() => [...window.__painter.sessionTools.file.bytes]));
    const commandKinds = await page.evaluate(async () => {
      const session = await SessionCodec.decode(window.__painter.sessionTools.file.bytes);
      return session.records.filter((r) => r.type === 'command').map((r) => r.command.op);
    });
    for (const op of ['palette', 'undo', 'redo', 'quality', 'bake', 'clear']) {
      assert.ok(commandKinds.includes(op), `the recording holds ${op}`);
    }
    check('a recording with palette, undo, redo, quality, bake and clear');

    assert.deepEqual(errors, []);

    // --- 320 px: no horizontal overflow, 44 px targets (AC-REC-10 groundwork) ---
    const phone = await browser.newPage({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true });
    await phone.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none`);
    await phone.waitForFunction(() => window.__painter && window.__painter.sessionTools);
    await phone.tap('#panel-extension-toggle');
    await phone.tap('#bake-tab');
    const layout = await phone.evaluate(() => {
      const page = document.getElementById('bake-page');
      const card = document.getElementById('session-card');
      const sizes = ['session-record', 'session-save', 'session-open'].map((id) =>
        document.getElementById(id).getBoundingClientRect());
      return { overflow: page.scrollWidth - page.clientWidth, cardRight: card.getBoundingClientRect().right,
        viewport: window.innerWidth, minHeight: Math.min(...sizes.map((r) => r.height)),
        saveOpenRow: Math.abs(sizes[1].top - sizes[2].top) < 1, recordWidth: sizes[0].width,
        cardWidth: card.getBoundingClientRect().width };
    });
    console.log(JSON.stringify({ check: '320px', ...layout }));
    assert.equal(layout.overflow, 0, 'no horizontal overflow at 320 px');
    assert.ok(layout.cardRight <= layout.viewport, 'card inside the viewport');
    assert.ok(layout.minHeight >= 44, 'touch targets >= 44 px');
    assert.ok(layout.saveOpenRow, 'Save and Open share a row');
    assert.ok(Math.abs(layout.recordWidth - layout.cardWidth) < 1, 'Record/Stop spans the card');
    check('320 px: no overflow, 44 px targets, Save/Open in one row, Record full width');

    // AC-REC-10 with a file opened: Open in Player spans the card too.
    await phone.setInputFiles('#session-open-input', savedPath);
    await phone.waitForFunction(() => !document.getElementById('session-open-player').hidden);
    const openedLayout = await phone.evaluate(() => {
      const page = document.getElementById('bake-page');
      const card = document.getElementById('session-card').getBoundingClientRect();
      const button = document.getElementById('session-open-player').getBoundingClientRect();
      return { overflow: page.scrollWidth - page.clientWidth, height: button.height,
        spans: Math.abs(button.width - card.width) < 1 };
    });
    console.log(JSON.stringify({ check: '320px opened', ...openedLayout }));
    assert.deepEqual({ overflow: openedLayout.overflow, spans: openedLayout.spans }, { overflow: 0, spans: true });
    assert.ok(openedLayout.height >= 44, 'Open in Player is a 44 px target');
    await phone.tap('#session-open-player');
    await phone.waitForFunction(() => !document.getElementById('story-player-page').hidden);
    const playerOverflow = await phone.evaluate(() => {
      const page = document.getElementById('story-player-page');
      return page.scrollWidth - page.clientWidth;
    });
    assert.equal(playerOverflow, 0, 'the Player with a session has no overflow at 320 px');
    check('320 px: Open in Player spans the card, 44 px; the Player tab does not overflow');
    await phone.close();

    // --- Phase 4: replay after reload through the UI (AC-REC-1, AC-REC-5) ----------
    const replay = async (name, bytes, original, { viewport = { width: 1100, height: 760 }, pauseAtOneX = false } = {}) => {
      const fresh = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const freshErrors = [];
      fresh.on('pageerror', (error) => freshErrors.push(error.message));
      fresh.on('console', (message) => {
        if (message.type() === 'error' && !/fluid-demo|Failed to load resource/.test(message.text())) {
          freshErrors.push(message.text());
        }
      });
      await fresh.goto(`http://127.0.0.1:${server.address().port}/index.html?debug=none`);
      await fresh.waitForFunction(() => window.__painter && window.__painter.sessionTools);
      await fresh.click('#panel-extension-toggle');
      await fresh.click('#bake-tab');
      await fresh.setInputFiles('#session-open-input', { name: `${name}.flus`, mimeType: 'application/octet-stream', buffer: bytes });
      await fresh.waitForFunction(() => !document.getElementById('session-open-player').hidden);
      await fresh.click('#session-open-player');
      await fresh.waitForFunction(() => !document.getElementById('story-player-page').hidden);
      const ui = await fresh.evaluate(() => ({
        file: document.getElementById('story-player-file-name').textContent,
        coverage: document.getElementById('story-player-coverage').textContent,
        colorsHidden: document.getElementById('story-color-model-group').hidden,
        thicknessDisabled: document.getElementById('story-thickness').disabled,
        framesDisabled: document.getElementById('story-previous-frame').disabled &&
          document.getElementById('story-next-frame').disabled,
      }));
      assert.equal(ui.file, `${name}.flus`);
      assert.match(ui.coverage, /^0 \/ [\d,]+ ticks · 0 \/ \d+ strokes$/);
      assert.deepEqual({ colorsHidden: ui.colorsHidden, thicknessDisabled: ui.thicknessDisabled,
        framesDisabled: ui.framesDisabled }, { colorsHidden: true, thicknessDisabled: true, framesDisabled: true });
      await fresh.check('input[name="story-canvas"][value="replace"]');

      let paused = null;
      if (pauseAtOneX) {
        await fresh.selectOption('#story-speed', '1');
        await fresh.click('#story-play-pause');
        await fresh.waitForFunction(() => window.__painter.storyPlaybackController.session.ticksDone > 40);
        await fresh.click('#story-play-pause');
        // Paused, the replay keeps the engine clock: the host adds no fluid steps.
        paused = await fresh.evaluate(async () => {
          const painter = window.__painter;
          const simulator = painter.engine.simulator;
          const before = simulator.frameNumber;
          await new Promise((resolve) => { let n = 15; const step = () => (--n ? requestAnimationFrame(step) : resolve()); requestAnimationFrame(step); });
          const record = document.getElementById('session-record');
          return { state: painter.storyPlaybackController.state, steps: simulator.frameNumber - before,
            activeAreas: simulator.splatAreas.length, recordDisabled: record.disabled, recordTitle: record.title,
            status: document.getElementById('story-player-status').textContent };
        });
        assert.equal(paused.state, 'paused');
        assert.equal(paused.steps, 0, 'no fluid step while a session replay is paused');
        assert.equal(paused.recordDisabled, true);
        assert.match(paused.recordTitle, /session is replaying/);
        await fresh.selectOption('#story-speed', 'max');
        await fresh.click('#story-play-pause');
      } else {
        await fresh.selectOption('#story-speed', 'max');
        await fresh.click('#story-play-pause');
      }
      await fresh.waitForFunction(() => window.__painter.storyPlaybackController.state === 'completed', null,
        { timeout: 180000 });
      const done = await fresh.evaluate(() => {
        const painter = window.__painter;
        const controller = painter.storyPlaybackController;
        const rectangle = painter.paintingRectangle;
        const screen = painter.viewport.worldRectToScreen(rectangle);
        return {
          status: document.getElementById('story-player-status').textContent,
          coverage: document.getElementById('story-player-coverage').textContent,
          header: controller.session.header.painting,
          rectangle: { left: rectangle.left, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
          viewScale: painter.viewport.viewScale,
          visible: screen.left >= 0 && screen.bottom >= 0 && screen.left + screen.width <= painter.canvas.width &&
            screen.bottom + screen.height <= painter.canvas.height,
          recordEnabled: !document.getElementById('session-record').disabled,
        };
      });
      const result = comparePixels(original, await exportPixels(fresh));
      console.log(JSON.stringify({ check: 'replay', name, viewport: `${viewport.width}x${viewport.height}`,
        pausedSteps: paused && paused.steps, viewScale: done.viewScale, coverage: done.coverage, ...result }));
      assert.equal(done.status, 'Playback completed.');
      assert.match(done.coverage, /^([\d,]+) \/ \1 ticks · (\d+) \/ \2 strokes$/);
      assert.deepEqual(done.rectangle, done.header, 'the painting sits where it was recorded');
      assert.equal(done.visible, true, 'the whole painting is on screen');
      assert.equal(done.recordEnabled, true, 'Record comes back when the replay completes');
      assert.equal(result.painted, true, 'the original is not blank');
      assert.ok(result.withinTwo >= 0.99, `AC-REC-5: ${result.withinTwo} of pixels within ±2`);
      // Stricter than AC-REC-5: float32 ticks replay within ±1 (phase 2). Stale
      // pressure from before Record passed the 99 % with 0.9975 but maxDelta 105.
      assert.ok(result.maxDelta <= 1, `replay within ±1, maxDelta ${result.maxDelta}`);
      assert.deepEqual(freshErrors, []);
      await fresh.close();
      return { ...result, viewScale: done.viewScale };
    };
    const results = {};
    results.empty = await replay('empty', bytes, originals.empty, { pauseAtOneX: true });
    check(`replay after reload, 1x -> pause -> Max: ${results.empty.withinTwo} within ±2, maxDelta ${results.empty.maxDelta}`);
    results.baseline = await replay('baseline', baselineFile, originals.baseline);
    check(`replay over a baseline PNG: ${results.baseline.withinTwo} within ±2, maxDelta ${results.baseline.maxDelta}`);
    results.commands = await replay('commands', commandsFile, originals.commands);
    check(`replay of every command: ${results.commands.withinTwo} within ±2, maxDelta ${results.commands.maxDelta}`);
    results.small = await replay('small-window', bytes, originals.empty, { viewport: { width: 700, height: 520 } });
    assert.ok(results.small.viewScale < 1, 'a smaller window zooms the view out');
    check(`replay in a smaller window zooms out (${results.small.viewScale.toFixed(2)}): ${results.small.withinTwo} within ±2`);
    console.log(`session-recording-ui: ${checks.length} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
