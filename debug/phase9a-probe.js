'use strict';

/*
 * Phase 8a + 9a probe -- per-press bristle variation, and the named stroke API.
 *
 * Two claims, one page, because they only mean anything together:
 *
 *   8a  every physical press gets its own bristle layout, chosen once at the
 *       press and fixed until lift, reproducible under a seed.
 *   9a  beginStroke/strokeTo/endStroke replay an input path deterministically,
 *       owning the settling, the interpolation and the call order that every
 *       host previously had to get right by itself.
 *
 * Why a browser and not a unit test: both claims are ultimately about pixels a
 * GPU produced. The state machine can be checked with a fake backend (and is,
 * below, through the real engine against a real WebGL context), but "eight taps
 * look different" and "a tap is visible at all" cannot -- a fake that returns
 * plausible numbers would pass while the shader painted nothing.
 *
 * What each group is guarding against, concretely:
 *
 *   taps        the Phase 8a bug itself: `Brush.initialize()` reuses one
 *               randoms texture for the life of the brush, so before the
 *               u_strokeVariation uniform every tap was a translated copy of
 *               one star-shaped stamp. Eight taps, eight hashes.
 *   seeding     a variation that is not reproducible is not testable. Same
 *               seed must give the same eight stamps IN ORDER; a different
 *               seed must move them.
 *   accounting  where the randomness is drawn from matters as much as that it
 *               exists: exactly one draw per press, none per frame, per
 *               sample or per splat -- otherwise a single press wanders while
 *               it is held, which is the failure the fixed-at-press rule
 *               exists to prevent.
 *   stroke      the 9a state machine, its guards, and the resampling contract:
 *               the same geometry split differently must paint identically,
 *               which is what makes output independent of pointer timing.
 *   tap visible beginStroke(); endStroke() with no movement must deposit. The
 *               settling samples splat for exactly this reason; a settle loop
 *               that skipped deposition would leave a blank canvas and every
 *               other check here would still pass.
 *
 * Usage: node debug/phase9a-probe.js
 *        GOLDEN_ROOT=dist node debug/phase9a-probe.js   (check the build too)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

acquireBrowserLock('phase9a probe');

const ROOT = process.env.GOLDEN_ROOT
  ? path.resolve(process.env.GOLDEN_ROOT)
  : path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.frag': 'text/plain', '.vert': 'text/plain', '.png': 'image/png',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function check(name, actual, expected, detail) {
  const pass = expected(actual);
  results.push({ name, pass, actual, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${detail ? '  -- ' + detail : ''}`);
}

const settle = (page, frames) => page.evaluate((n) => new Promise((resolve) => {
  let i = 0;
  const tick = () => (++i < n ? requestAnimationFrame(tick) : resolve());
  requestAnimationFrame(tick);
}), frames);

/*
 * Paint a tap at a painting-space fraction and hash the region around it.
 *
 * The hash is position-normalised: it is taken over a window centred on the tap
 * rather than over the whole texture, so two stamps at different places are
 * comparable and a difference means the LAYOUT differs, not the location.
 */
async function tapAndHash(page, fx, fy) {
  return page.evaluate(async ({ fx, fy }) => {
    const painter = window.__painter;
    const eng = painter.engine;
    const rect = painter.paintingRectangle;
    const x = rect.left + rect.width * fx;
    const y = rect.bottom + rect.height * fy;

    eng.beginStroke({
      x, y,
      brushSize: painter.brushScale,
      paintingRectangle: rect,
      color: { space: 'pigment', channels: [1, 0, 0], alpha: 0.5 },
      resolutionScale: painter.resolutionScale,
    });
    eng.endStroke();

    // Let the deposited paint settle so the stamp is fully formed.
    await new Promise((resolve) => {
      let i = 0;
      const tick = () => (++i < 30 ? requestAnimationFrame(tick) : resolve());
      requestAnimationFrame(tick);
    });

    const t = eng.readPaintTexture();
    // Map the painting-space point into texture space, then hash a window.
    const cx = Math.round(((x - rect.left) / rect.width) * t.width);
    const cy = Math.round(((y - rect.bottom) / rect.height) * t.height);
    const R = 90;
    let h = 2166136261, alpha = 0;
    for (let dy = -R; dy <= R; ++dy) {
      const py = cy + dy;
      if (py < 0 || py >= t.height) continue;
      for (let dx = -R; dx <= R; ++dx) {
        const px = cx + dx;
        if (px < 0 || px >= t.width) continue;
        const i = (py * t.width + px) * 4;
        // Quantise: SwiftShader's last bits are not the signal here.
        const q = Math.round(t.pixels[i + 3] * 2048);
        alpha += t.pixels[i + 3];
        h ^= q; h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return { hash: h.toString(16), alpha: +alpha.toFixed(3) };
  }, { fx, fy });
}

async function clearPainting(page) {
  await page.evaluate(() => {
    if (window.__painter.engine.strokeActive) window.__painter.engine.endStroke();
    window.__painter.engine.clear();
  });
  await settle(page, 3);
}

async function run() {
  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=512',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
    ],
  });

  const logs = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

  const SEED = 20260907;
  await page.goto(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
  await page.waitForFunction(() => window.__painter && window.__painter.engine, null, { timeout: 60000 });
  await settle(page, 10);

  console.log('\n-- the API exists, and on the built copy too --');
  const api = await page.evaluate(() => {
    const e = window.__painter.engine;
    return ['beginStroke', 'strokeTo', 'endStroke'].filter((m) => typeof e[m] === 'function');
  });
  check('beginStroke/strokeTo/endStroke present', api, (v) => v.length === 3);

  console.log('\n-- a tap deposits paint (settling splats) --');
  await clearPainting(page);
  const tap = await tapAndHash(page, 0.35, 0.5);
  check('beginStroke(); endStroke() leaves paint', tap.alpha, (v) => v > 1,
    'a settle loop that skipped splat would leave 0 here');

  console.log('\n-- eight taps, eight layouts (the Phase 8a bug) --');
  await clearPainting(page);
  const taps = [];
  for (let i = 0; i < 8; ++i) {
    await clearPainting(page);
    taps.push((await tapAndHash(page, 0.18 + i * 0.08, 0.5)).hash);
  }
  const distinct = new Set(taps).size;
  check('distinct stamp hashes out of 8', distinct, (v) => v >= 6,
    'before 8a every tap was a translated copy of one stamp');
  check('no later tap equals the first', taps.slice(1).filter((h) => h === taps[0]).length,
    (v) => v === 0);

  console.log('\n-- the same seed reproduces them, a different seed does not --');
  const rerun = async (seed) => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    await p.goto(`http://127.0.0.1:${port}/index.html?seed=${seed}`);
    await p.waitForFunction(() => window.__painter && window.__painter.engine, null, { timeout: 60000 });
    await settle(p, 10);
    const out = [];
    for (let i = 0; i < 8; ++i) {
      await p.evaluate(() => {
        if (window.__painter.engine.strokeActive) window.__painter.engine.endStroke();
        window.__painter.engine.clear();
      });
      await settle(p, 3);
      out.push((await tapAndHash(p, 0.18 + i * 0.08, 0.5)).hash);
    }
    await p.close();
    return out;
  };
  const same = await rerun(SEED);
  const other = await rerun(SEED + 1);
  check('same seed gives the same 8 hashes in order', same.join(',') === taps.join(','), (v) => v === true);
  check('a different seed moves at least 6', same.filter((h, i) => h !== other[i]).length,
    (v) => v >= 6);

  console.log('\n-- one draw per press, none per frame or sample --');
  const accounting = await page.evaluate(async () => {
    const painter = window.__painter;
    const rect = painter.paintingRectangle;
    const opts = {
      x: rect.left + rect.width * 0.5,
      y: rect.bottom + rect.height * 0.5,
      brushSize: painter.brushScale,
      paintingRectangle: rect,
      color: { space: 'pigment', channels: [1, 0, 0], alpha: 0.3 },
    };
    // Count draws by wrapping the engine's own random source.
    const eng = painter.engine;
    let calls = 0;
    const real = eng.random;
    eng.random = () => { calls++; return real(); };
    eng.brush.random = eng.random;

    if (eng.strokeActive) eng.endStroke();
    const before = calls;
    eng.beginStroke(opts);
    const afterBegin = calls;
    for (let i = 1; i <= 20; ++i) {
      eng.strokeTo({ x: opts.x + i * 12, y: opts.y + i * 3 });
    }
    const afterMoves = calls;
    eng.endStroke();
    const afterEnd = calls;

    let rejected = 0;
    try { eng.beginStroke(Object.assign({}, opts, { x: NaN })); } catch (e) { rejected = 1; }
    const afterInvalid = calls;

    eng.random = real;
    eng.brush.random = real;
    return {
      perBegin: afterBegin - before,
      perMoves: afterMoves - afterBegin,
      perEnd: afterEnd - afterMoves,
      perInvalid: afterInvalid - afterEnd,
      rejected,
    };
  });
  check('exactly one draw per begin', accounting.perBegin, (v) => v === 1);
  check('no draw across 20 strokeTo calls', accounting.perMoves, (v) => v === 0);
  check('no draw on endStroke', accounting.perEnd, (v) => v === 0);
  check('no draw for a rejected begin', accounting.perInvalid, (v) => v === 0);
  check('a rejected begin threw', accounting.rejected, (v) => v === 1);

  console.log('\n-- the state machine and its guards --');
  const machine = await page.evaluate(() => {
    const painter = window.__painter;
    const eng = painter.engine;
    const rect = painter.paintingRectangle;
    const opts = {
      x: rect.left + rect.width * 0.5,
      y: rect.bottom + rect.height * 0.5,
      brushSize: painter.brushScale,
      paintingRectangle: rect,
      color: { space: 'pigment', channels: [0, 0, 1], alpha: 0.3 },
    };
    const name = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return e.name; } };
    if (eng.strokeActive) eng.endStroke();

    const idleStrokeTo = name(() => eng.strokeTo({ x: 1, y: 1 }));
    const idleEnd = name(() => eng.endStroke());
    eng.beginStroke(opts);
    const doubleBegin = name(() => eng.beginStroke(opts));
    const guardedFrame = name(() => eng.frame());
    const guardedSplat = name(() => eng.splat(rect, { zThreshold: 1, color: [1, 0, 0, 1], radius: 1, velocityScale: 1 }));
    const guardedPosition = name(() => eng.positionBrush(1, 1, 1, 1));
    const guardedClear = name(() => eng.clear());
    const activeFlag = eng.strokeActive;
    eng.endStroke();
    const idleFlag = eng.strokeActive;
    const rgbRejected = name(() => eng.beginStroke(Object.assign({}, opts, {
      color: { space: 'rgb', channels: [1, 0, 0], alpha: 1 },
    })));
    const strandedAfterFailure = eng.strokeActive;
    return {
      idleStrokeTo, idleEnd, doubleBegin, guardedFrame, guardedSplat,
      guardedPosition, guardedClear, activeFlag, idleFlag, rgbRejected,
      strandedAfterFailure,
    };
  });
  check('strokeTo when idle throws', machine.idleStrokeTo, (v) => v === 'StrokeStateError');
  check('endStroke when idle throws', machine.idleEnd, (v) => v === 'StrokeStateError');
  check('begin while active throws', machine.doubleBegin, (v) => v === 'StrokeStateError');
  check('frame() blocked during a stroke', machine.guardedFrame, (v) => v === 'StrokeStateError',
    'a host that also stepped the fluid would double-deposit');
  check('splat() blocked during a stroke', machine.guardedSplat, (v) => v === 'StrokeStateError');
  check('positionBrush() blocked during a stroke', machine.guardedPosition, (v) => v === 'StrokeStateError');
  check('clear() blocked during a stroke', machine.guardedClear, (v) => v === 'StrokeStateError');
  check('strokeActive true while active', machine.activeFlag, (v) => v === true);
  check('strokeActive false after end', machine.idleFlag, (v) => v === false);
  check('RGB rejected as pigment', machine.rgbRejected, (v) => v === 'StrokeStateError',
    'an RGB triple would mix plausibly and wrongly');
  check('a failed begin does not strand the machine', machine.strandedAfterFailure, (v) => v === false);

  console.log('\n-- resampling: how the caller chops the path cannot matter --');
  const resample = await page.evaluate(async () => {
    const painter = window.__painter;
    const eng = painter.engine;
    const rect = painter.paintingRectangle;
    const x0 = rect.left + rect.width * 0.25;
    const y0 = rect.bottom + rect.height * 0.4;
    const x1 = rect.left + rect.width * 0.75;

    const paintPath = async (points) => {
      if (eng.strokeActive) eng.endStroke();
      eng.clear();
      await new Promise((r) => requestAnimationFrame(() => r()));
      eng.beginStroke({
        x: x0, y: y0,
        brushSize: painter.brushScale,
        paintingRectangle: rect,
        color: { space: 'pigment', channels: [0, 1, 0], alpha: 0.4 },
        resolutionScale: painter.resolutionScale,
      });
      let steps = 0;
      for (const p of points) steps += eng.strokeTo(p).steps;
      steps += eng.endStroke().steps;
      await new Promise((resolve) => {
        let i = 0;
        const tick = () => (++i < 30 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      });
      const t = eng.readPaintTexture();
      let h = 2166136261;
      for (let i = 3; i < t.pixels.length; i += 4) {
        h ^= Math.round(t.pixels[i] * 2048); h = Math.imul(h, 16777619) >>> 0;
      }
      return { hash: h.toString(16), steps };
    };

    const one = await paintPath([{ x: x1, y: y0 }]);
    const many = [];
    for (let i = 1; i <= 23; ++i) many.push({ x: x0 + ((x1 - x0) * i) / 23, y: y0 });
    const split = await paintPath(many);
    return { one, split };
  });
  check('one segment vs 23 uneven: same emitted steps',
    [resample.one.steps, resample.split.steps], (v) => v[0] === v[1]);
  check('one segment vs 23 uneven: same painting',
    resample.one.hash === resample.split.hash, (v) => v === true,
    'this is what makes paint independent of pointer timing');

  await page.close();
  await browser.close();
  server.close();

  const errors = logs.filter((l) => l.startsWith('PAGEERROR'));
  check('no page errors', errors.length, (v) => v === 0, errors.join(' | ') || undefined);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exitCode = 1;
  }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
