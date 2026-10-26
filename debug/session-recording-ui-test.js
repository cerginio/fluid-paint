'use strict';

// fluid-session phase 3: the State tab's Session recording card, end to end in
// the real page (SwiftShader). Record -> real mouse strokes + Undo -> close the
// panel (recording continues, chip visible) -> Stop -> Save -> the downloaded
// .flus decodes to what was painted. Also the unsaved guard, beforeunload,
// Resize ending a recording, Open…, the 320 px layout and recorder overhead.
//
//   node debug/session-recording-ui-test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Session recording UI');

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

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
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
    await page.click('#session-record');
    await page.waitForFunction(() => window.__painter.sessionTools.phase === 'recorded');
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
    check('Record over a painting: baseline note, undo history starts over');

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
    assert.match(await page.locator('#session-note').textContent(), /painting was resized/);
    const resized = await page.evaluate(async () => {
      const session = await SessionCodec.decode(window.__painter.sessionTools.file.bytes);
      return { baseline: session.header.baseline, png: session.baselinePng && session.baselinePng.length,
        stopReason: session.header.stopReason };
    });
    assert.deepEqual({ baseline: resized.baseline, stopReason: resized.stopReason }, { baseline: 'png', stopReason: 'resize' });
    assert.ok(resized.png > 100, 'baseline PNG embedded');
    check('Resize stops the recording and keeps it; the file carries a baseline PNG');

    // --- Open… ----------------------------------------------------------------
    await page.click('#session-open');
    await page.click('#session-discard-confirm');
    // Discard ran the held action: the file chooser opens through the input.
    await page.setInputFiles('#session-open-input', savedPath);
    await page.waitForFunction(() => !document.getElementById('session-opened').hidden &&
      document.getElementById('session-opened').textContent.includes('Exact'));
    const opened = await page.locator('#session-opened').textContent();
    assert.match(opened, /4 strokes · .* ticks · \d+ KB · Exact · starts from an empty canvas/);
    assert.equal(await status(), 'Not recording', 'Discard dropped the unsaved recording');
    const junk = path.join(path.dirname(savedPath), 'junk.flus');
    fs.writeFileSync(junk, 'not a session');
    await page.setInputFiles('#session-open-input', junk);
    await page.waitForFunction(() => document.getElementById('session-opened').classList.contains('is-error'));
    assert.match(await page.locator('#session-opened').textContent(), /not a Fluid Paint session/);
    check('Open… summarises a saved file as Exact, and names a damaged one');

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
    await phone.close();
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
