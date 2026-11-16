'use strict';
/*
 * Eraser through the real app: panel toggle, cursor footprint, mouse gesture,
 * frozen fluid, undo/redo, keyboard shortcuts, and session-command replay.
 *
 *   node debug/eraser-gpu-test.js             SwiftShader (CI default)
 *   node debug/eraser-gpu-test.js --hardware  the real GPU
 *
 * Short by design: one page, one painting, a few seconds of waiting.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('eraser GPU check');

const hardware = process.argv.includes('--hardware');
const root = path.resolve(__dirname, '..', process.argv.includes('--built') ? 'dist' : '.');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: hardware
    ? ['--use-angle=d3d11', '--renderer-process-limit=1']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'] });
  const ok = (name) => console.log(`ok - ${name}`);
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=7&debug=none&diag=0`);
    await page.waitForFunction(() => window.__painter?.engine, { timeout: 30000 });

    // Page coordinates of a world point.
    const toPage = (wx, wy) => page.evaluate(([x, y]) => {
      const p = window.__painter, s = p.viewport.worldToScreen(x, y);
      const c = p.viewport.screenToCss(s.x, s.y), r = p.canvas.getBoundingClientRect();
      return { x: r.left + c.x, y: r.top + c.y };
    }, [wx, wy]);
    const center = await page.evaluate(() => {
      const r = window.__painter.paintingRectangle;
      return { x: r.left + r.width / 2, y: r.bottom + r.height / 2 };
    });

    // 1. A thick brush stroke with the real mouse.
    await page.evaluate(() => { window.__painter.brushScale = 40; });
    const a = await toPage(center.x - 200, center.y);
    const b = await toPage(center.x + 200, center.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 20, a.y); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(1500); // > 60 simulation frames: the fluid settles
    const painted = await page.evaluate(() => {
      const t = window.__painter.engine.readPaintTexture();
      window.__before = t.pixels.slice();
      let n = 0; for (let i = 3; i < t.pixels.length; i += 4) if (t.pixels[i] > 0) n++;
      return n;
    });
    assert.ok(painted > 1000, `brush stroke painted (${painted} texels)`);
    ok('brush stroke painted');

    // 2. The bar button selects the eraser with the panel COLLAPSED: the
    //    tool must be one tap away at any moment.
    await page.evaluate(() => { const ui = document.getElementById('ui'); ui.hidden = false; });
    assert.equal(await page.evaluate(() => document.getElementById('ui').dataset.collapsed), 'true');
    await page.click('#tool-toggle');
    assert.deepEqual(await page.evaluate(() => {
      const b = document.getElementById('tool-toggle');
      return [window.__painter.activeTool, b.dataset.tool, b.getAttribute('aria-pressed')];
    }), ['eraser', 'eraser', 'true']);
    ok('bar button selects the eraser with the panel collapsed');
    await page.evaluate(() => { const ui = document.getElementById('ui'); ui.hidden = true; });

    // 3. Hover shows a circle at the real footprint.
    const m = await toPage(center.x, center.y);
    await page.mouse.move(m.x - 5, m.y);
    await page.mouse.move(m.x, m.y);
    await page.waitForTimeout(60);
    const cursor = await page.evaluate(() => {
      const p = window.__painter, el = p.eraserCursor, r = el.getBoundingClientRect();
      return { hidden: el.hidden, width: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        expected: 2 * FluidEngine.eraserRadius(p.brushScale) * p.viewport.viewScale / p.viewport.pixelRatio,
        canvasCursor: p.canvas.style.cursor };
    });
    assert.equal(cursor.hidden, false, 'eraser circle visible on hover');
    // The box-shadow outline is outside the border box, so width is exact.
    assert.ok(Math.abs(cursor.width - cursor.expected) < 1, `circle ${cursor.width}px, footprint ${cursor.expected}px`);
    assert.ok(Math.abs(cursor.cx - m.x) < 1.5 && Math.abs(cursor.cy - m.y) < 1.5, 'circle centred on pointer');
    assert.equal(cursor.canvasCursor, 'none');
    ok('hover circle matches the footprint and hides the system cursor');

    // 4. Erase across the stroke with the mouse.
    const e0 = await toPage(center.x - 100, center.y - 60);
    const e1 = await toPage(center.x + 100, center.y + 60);
    await page.mouse.move(e0.x, e0.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__painter.engine.eraseActive), true);
    for (let i = 1; i <= 15; i++) { await page.mouse.move(e0.x + (e1.x - e0.x) * i / 15, e0.y + (e1.y - e0.y) * i / 15); await page.waitForTimeout(16); }
    await page.mouse.up();
    const erased = await page.evaluate(([c, r0]) => {
      const p = window.__painter, e = p.engine, t = e.readPaintTexture(), rect = p.paintingRectangle;
      window.__erased = t.pixels.slice();
      const sx = t.width / rect.width, sy = t.height / rect.height;
      const ax = c.x - 100, ay = c.y - 60, bx = c.x + 100, by = c.y + 60;
      let insidePainted = 0, insideLeft = 0, outsideChanged = 0;
      for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) {
        const wx = rect.left + (x + 0.5) / sx, wy = rect.bottom + (y + 0.5) / sy;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const k = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / l2));
        const d = Math.hypot(wx - ax - k * dx, wy - ay - k * dy), i = (y * t.width + x) * 4;
        if (d < r0 - 4) {
          if (window.__before[i + 3] > 0) insidePainted++;
          if (t.pixels[i] || t.pixels[i + 1] || t.pixels[i + 2] || t.pixels[i + 3]) insideLeft++;
        } else if (d > r0 + 2) {
          for (let ch = 0; ch < 4; ch++) if (t.pixels[i + ch] !== window.__before[i + ch]) { outsideChanged++; break; }
        }
      }
      return { active: e.eraseActive, insidePainted, insideLeft, outsideChanged };
    }, [center, 40]);
    assert.equal(erased.active, false, 'gesture ended on mouse up');
    assert.ok(erased.insidePainted > 500, `the sweep crossed paint (${erased.insidePainted})`);
    assert.equal(erased.insideLeft, 0, 'no material left inside the footprint');
    assert.equal(erased.outsideChanged, 0, 'nothing outside the footprint changed');
    ok('mouse sweep removes all material inside, none outside');

    // 5. The hole stays open.
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => {
      const t = window.__painter.engine.readPaintTexture().pixels;
      return t.every((v, i) => v === window.__erased[i]);
    }), true, 'paint unchanged one second after erasing');
    ok('erased area does not refill');

    // 6. Undo restores the exact pre-erase paint, redo the erased paint.
    const history = await page.evaluate(async () => {
      const p = window.__painter, read = () => p.engine.readPaintTexture().pixels;
      await p.undo(); const undone = read().every((v, i) => v === window.__before[i]);
      await p.redo(); const redone = read().every((v, i) => v === window.__erased[i]);
      return { undone, redone };
    });
    assert.deepEqual(history, { undone: true, redone: true });
    ok('undo and redo are exact');

    // 7. Recorded command replays to the same paint.
    const replay = await page.evaluate(async ([c]) => {
      const p = window.__painter, e = p.engine, rec = p.sessionRecorder;
      rec.start({ bristleSeed: 3, prepare: () => ({}) });
      const r = p.paintingRectangle;
      e.beginErase({ x: c.x, y: c.y + 120, brushSize: 25, paintingRectangle: r });
      for (let i = 1; i <= 12; i++) e.eraseTo({ x: c.x + i * 9, y: c.y + 120 - i * 14 });
      e.endErase();
      const live = e.readPaintTexture().pixels.slice();
      rec.stop();
      const command = rec.records.find((x) => x.type === 'command' && x.command.op === 'erase')?.command;
      // The direct calls took no snapshot, so undo+redo lands on the state
      // the recorded gesture started from.
      await p.undo();
      await p.redo();
      e.beginErase(command.params);
      for (let i = 0; i < command.points.length; i += 2) e.eraseTo({ x: command.points[i], y: command.points[i + 1] });
      e.endErase();
      const replayed = e.readPaintTexture().pixels;
      return { found: !!command, points: command ? command.points.length / 2 : 0,
        same: replayed.every((v, i) => v === live[i]) };
    }, [center]);
    assert.deepEqual(replay, { found: true, points: 12, same: true });
    ok('recorded erase command replays bit-for-bit');

    // 8. Touch: a second finger rolls the tentative erase back entirely;
    //    a single finger commits. Real multi-contact input via CDP.
    await page.evaluate(() => {
      window.__touchBase = window.__painter.engine.readPaintTexture().pixels.slice();
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 0.5 })) });
    const t0 = await toPage(center.x - 150, center.y);
    await touch('touchStart', [[1, t0.x, t0.y]]);
    await touch('touchMove', [[1, t0.x + 40, t0.y]]);
    await page.waitForTimeout(40);
    await touch('touchStart', [[1, t0.x + 40, t0.y], [2, t0.x + 200, t0.y + 100]]);
    await touch('touchEnd', []);
    await page.waitForTimeout(40);
    const cancelled = await page.evaluate(() => {
      const e = window.__painter.engine, t = e.readPaintTexture().pixels;
      return { active: e.eraseActive, same: t.every((v, i) => v === window.__touchBase[i]) };
    });
    assert.deepEqual(cancelled, { active: false, same: true });
    await touch('touchStart', [[1, t0.x, t0.y]]);
    await touch('touchMove', [[1, t0.x + 40, t0.y]]);
    await page.waitForTimeout(40);
    await touch('touchEnd', []);
    await page.waitForTimeout(40);
    const committed = await page.evaluate(async () => {
      const p = window.__painter, read = () => p.engine.readPaintTexture().pixels;
      const changed = !read().every((v, i) => v === window.__touchBase[i]);
      await p.undo();
      return { active: p.engine.eraseActive, changed, undone: read().every((v, i) => v === window.__touchBase[i]) };
    });
    assert.deepEqual(committed, { active: false, changed: true, undone: true });
    ok('touch: second finger cancels the erase, one finger commits and undoes');

    // 9. Keyboard shortcuts.
    await page.keyboard.press('KeyB');
    assert.equal(await page.evaluate(() => window.__painter.activeTool), 'brush');
    await page.keyboard.press('KeyE');
    assert.equal(await page.evaluate(() => window.__painter.activeTool), 'eraser');
    await page.keyboard.press('KeyB');
    assert.equal(await page.evaluate(() => document.getElementById('tool-toggle').dataset.tool), 'brush');
    ok('B and E switch tools and the bar button follows');

    assert.deepEqual(errors, []);
    ok('no page errors');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
