'use strict';

// SPEC §2.3 / fluid-session phase 2: can a live session be replayed from what
// the engine observer saw? Programmatic live strokes are recorded on one page,
// then replayed on fresh pages through replayTick(). No page has ?seed=, so
// Math.random differs on every load: the replay may rely only on the recorded
// bristle seed and press variations, exactly as a file after reload would.
//
// Variants: float64 as recorded, float32 (what the GPU uniforms receive),
// quantised contacts, the SPEC's xy:64/h:4096 and a 1/65536 px tick quantum.
// A control replays without reseedBristleRandoms() and must NOT match, which
// is what shows the comparison can see a difference at all.
//
//   node debug/session-replay-gpu-test.js              SwiftShader
//   node debug/session-replay-gpu-test.js --hardware   real GPU (ANGLE D3D11)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const SessionCodec = require('../app/session-codec.js');
require('./browser-lock').acquireBrowserLock('session replay GPU check');

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

const BRISTLE_SEED = 2654435761;

// Same fresh wet state on every page, and no host RAF steps during the run.
function preparePage() {
  const painter = window.__painter;
  painter.update = () => {};
  const engine = painter.engine;
  if (engine.strokeActive) engine.endStroke();
  engine.clear();
  engine.simulator.clearTextures([engine.simulator.velocityTexture, engine.simulator.velocityTextureTemp]);
  engine.simulator.splatAreas = [];
  engine.resetClock(0);
}

function exportBase64() {
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
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: hardware
    ? ['--use-angle=d3d11', '--renderer-process-limit=1']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'] });
  const url = `http://127.0.0.1:${server.address().port}/index.html?debug=none&diag=0`;
  const openPage = async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__painter && window.__painter.engine);
    await page.evaluate(`(${preparePage})()`);
    return { page, errors };
  };

  try {
    // --- Record ------------------------------------------------------------
    const { page: recordPage, errors: recordErrors } = await openPage();
    const recording = await recordPage.evaluate(async ({ seed, exportSource }) => {
      const exportPixels = eval(`(${exportSource})`);
      const painter = window.__painter;
      const engine = painter.engine;
      const rectangle = painter.paintingRectangle;
      engine.reseedBristleRandoms(seed);

      const events = [];
      engine.setSessionObserver({
        onBeginStroke: (params, variation) => events.push(['begin', params, variation]),
        onTick: (x, y, height, scale) => events.push(['tick', x, y, height, scale]),
        onIdleTick: () => events.push(['idle']),
        onContact: (x, y, pressure) => events.push(['contact', x, y, pressure]),
        onEndStroke: () => events.push(['end']),
      });

      // Input timing is a fixed pseudo-random sequence so a re-run records the
      // same gestures; the point is that it is irregular, not that it is random.
      let state = 99;
      const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 4294967296; };
      let now = 0;
      const at = (u, v) => ({ x: rectangle.left + rectangle.width * u, y: rectangle.bottom + rectangle.height * v });
      const pigment = (channels, alpha) => ({ space: 'pigment', channels, alpha });
      const idle = (seconds) => { const until = now + seconds; while (now < until) { now += 1 / 60; engine.advance(now); } };
      const stroke = (options, path) => {
        const first = path(0);
        engine.beginStroke({ timing: 'live', paintingRectangle: rectangle, resolutionScale: painter.resolutionScale,
          x: first.x, y: first.y, pressure: first.pressure, ...options });
        const samples = 40;
        for (let i = 1; i <= samples; i++) {
          const point = path(i / samples);
          engine.strokeTo(point);
          // Pointer events at 8-34 ms with two janks: one of three ticks
          // (interpolated steps) and one past the five-step cap (dropped).
          now += i === 13 ? 0.05 : i === 27 ? 0.12 : 0.008 + 0.026 * next();
          engine.advance(now);
        }
        // pointerup carrying a new endpoint without a RAF in between.
        const last = path(1);
        engine.strokeTo({ x: last.x + 6, y: last.y - 3, pressure: last.pressure });
        engine.endStroke();
      };

      stroke({ brushSize: 40, color: pigment([1, 0, 0], 0.6) }, (s) => {
        const p = at(0.15 + 0.6 * s, 0.5 + 0.2 * Math.sin(s * Math.PI * 2));
        return { ...p, pressure: 0.3 + 0.6 * s };
      });
      idle(0.3);
      // A tap: begin and end before any tick.
      const tap = at(0.8, 0.25);
      engine.beginStroke({ timing: 'live', paintingRectangle: rectangle, resolutionScale: painter.resolutionScale,
        x: tap.x, y: tap.y, pressure: 0.8, brushSize: 30, color: pigment([0, 0, 1], 0.7) });
      engine.endStroke();
      idle(0.2);
      stroke({ brushSize: 32, color: pigment([0, 0, 1], 0.5), randomizeBristles: true,
        brushShape: { sides: 4, aspect: 2, rotation: 0.5 } }, (s) => {
        const p = at(0.3 + 0.1 * s, 0.2 + 0.65 * s);
        return { ...p, pressure: 0.9 - 0.5 * s };
      });
      idle(0.1);
      // Wet-on-wet across the first two strokes.
      stroke({ brushSize: 55, color: pigment([0, 1, 0], 0.4) }, (s) => {
        const p = at(0.1 + 0.75 * s, 0.35 + 0.1 * s);
        return { ...p, pressure: 0.6 };
      });
      // Settle: a splat area simulates 60 steps; replayed as idle ticks too.
      for (let i = 0; i < 80; i++) engine.stepTick();
      engine.setSessionObserver(null);
      // Export now: the failure check below paints, and is not in the recording.
      const pixels = exportPixels();

      // An observer that throws is detached; the stroke it watched completes.
      const originalError = console.error;
      let consoleErrors = 0;
      console.error = () => { consoleErrors++; };
      engine.setSessionObserver({ onTick: () => { throw new Error('observer failure'); } });
      const before = engine.readPaintTexture().pixels.reduce((sum, value) => sum + value, 0);
      engine.beginStroke({ timing: 'live', paintingRectangle: rectangle, x: at(0.5, 0.9).x, y: at(0.5, 0.9).y,
        brushSize: 20, color: pigment([1, 1, 0], 0.5) });
      for (let i = 1; i <= 5; i++) { engine.strokeTo({ x: at(0.5 + 0.02 * i, 0.9).x, y: at(0.5, 0.9).y }); engine.stepTick(); }
      engine.endStroke();
      const after = engine.readPaintTexture().pixels.reduce((sum, value) => sum + value, 0);
      console.error = originalError;
      const observerFailure = { detached: engine._sessionObserver === null, consoleErrors,
        strokeActive: engine.strokeActive, painted: after !== before };

      const gl = painter.wgl.gl;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return { events, pixels, observerFailure, renderer };
    }, { seed: BRISTLE_SEED, exportSource: exportBase64.toString() });
    assert.deepEqual(recordErrors, []);
    await recordPage.close();

    const counts = {};
    for (const [kind] of recording.events) counts[kind] = (counts[kind] || 0) + 1;
    console.log(JSON.stringify({ check: 'recording', renderer: recording.renderer, counts }));
    // For codec experiments: SESSION_REPLAY_DUMP=<file> writes the raw events.
    if (process.env.SESSION_REPLAY_DUMP) {
      fs.writeFileSync(process.env.SESSION_REPLAY_DUMP, JSON.stringify(recording.events));
    }
    assert.equal(counts.begin, 4);
    assert.equal(counts.end, 4);
    assert.ok(counts.tick > 100 && counts.idle > 80);
    assert.ok(counts.contact >= 3, 'the three strokes end on a pointerup endpoint');
    assert.deepEqual(recording.observerFailure,
      { detached: true, consoleErrors: 1, strokeActive: false, painted: true });

    // Phase 3: the same events through the .flus codec and back. Ticks are
    // stored as float32 (the scale is the stroke's brushSize), contacts as
    // float64, so this must replay like the float32 variant below.
    const viaCodec = async (events) => {
      const records = [];
      let ticks = [];
      const flush = () => {
        if (ticks.length) records.push({ type: 'ticks', data: Float32Array.from(ticks) });
        ticks = [];
      };
      for (const event of events) {
        switch (event[0]) {
          case 'begin': records.push({ type: 'begin', params: event[1], variation: event[2] }); break;
          case 'tick':
            assert.equal(event[4], records.findLast((r) => r.type === 'begin').params.brushSize);
            ticks.push(event[1], event[2], event[3]);
            break;
          case 'idle': {
            const last = records.at(-1);
            if (last && last.type === 'idle') last.count++;
            else records.push({ type: 'idle', count: 1 });
            break;
          }
          case 'contact': flush(); records.push({ type: 'contact', x: event[1], y: event[2], pressure: event[3] }); break;
          case 'end': flush(); records.push({ type: 'end' }); break;
        }
      }
      const file = await SessionCodec.encode({ header: {}, records });
      const decoded = await SessionCodec.decode(file);
      const out = [];
      let brushSize = 0;
      for (const record of decoded.records) {
        switch (record.type) {
          case 'begin': {
            const { variation, ...params } = { ...record.params, variation: record.variation };
            brushSize = params.brushSize;
            out.push(['begin', params, variation]);
            break;
          }
          case 'ticks':
            for (let i = 0; i < record.data.length; i += 3) {
              out.push(['tick', record.data[i], record.data[i + 1], record.data[i + 2], brushSize]);
            }
            break;
          case 'idle': for (let i = 0; i < record.count; i++) out.push(['idle']); break;
          case 'contact': out.push(['contact', record.x, record.y, record.pressure]); break;
          case 'end': out.push(['end']); break;
        }
      }
      const tickCount = events.filter((event) => event[0] === 'tick').length;
      console.log(JSON.stringify({ check: 'codec', fileBytes: file.length, ticks: tickCount,
        bytesPerTick: Math.round(file.length / tickCount * 100) / 100 }));
      return out;
    };
    const codecEvents = await viaCodec(recording.events);

    // --- Replay ------------------------------------------------------------
    const replay = async (name, { events = recording.events, xy = 0, height = 0, contactXY = 0, contactPressure = false, fround = false, reseed = true }) => {
      const { page, errors } = await openPage();
      const result = await page.evaluate(({ events, original, xy, height, contactXY, contactPressure, fround, reseed, seed, exportSource }) => {
        const exportPixels = eval(`(${exportSource})`);
        const engine = window.__painter.engine;
        if (reseed) engine.reseedBristleRandoms(seed);
        const q = (value, origin, quantum) => fround ? Math.fround(value)
          : quantum ? origin + Math.round((value - origin) * quantum) / quantum : value;
        let rectangle = null;
        let contact = null;
        for (const event of events) {
          switch (event[0]) {
            case 'begin':
              rectangle = event[1].paintingRectangle;
              engine.beginStroke({ ...event[1], variation: event[2] });
              break;
            case 'tick': {
              const [, x, y, h, scale] = event;
              engine.replayTick(q(x, rectangle.left, xy), q(y, rectangle.bottom, xy),
                fround ? Math.fround(h) : height ? Math.round(h / scale * height) / height * scale : h, scale);
              break;
            }
            case 'idle': engine.replayTick(); break;
            case 'contact':
              contact = { x: q(event[1], rectangle.left, contactXY), y: q(event[2], rectangle.bottom, contactXY),
                pressure: contactPressure ? Math.round(event[3] * 65535) / 65535 : event[3] };
              break;
            case 'end': engine.endStroke({ contact }); contact = null; break;
          }
        }
        const replayed = atob(exportPixels());
        const source = atob(original);
        const width = window.__painter.paintingRectangle.width;
        let identicalBytes = 0, withinTwo = 0, maxDelta = 0, hash = 0x811c9dc5;
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < source.length; i += 4) {
          let pixelMax = 0;
          for (let c = 0; c < 4; c++) {
            const delta = Math.abs(source.charCodeAt(i + c) - replayed.charCodeAt(i + c));
            if (delta === 0) identicalBytes++;
            if (delta > pixelMax) pixelMax = delta;
            hash = Math.imul(hash ^ replayed.charCodeAt(i + c), 0x01000193) >>> 0;
          }
          if (pixelMax <= 2) withinTwo++;
          else {
            const px = (i / 4) % width, py = Math.floor(i / 4 / width);
            box[0] = Math.min(box[0], px); box[1] = Math.min(box[1], py);
            box[2] = Math.max(box[2], px); box[3] = Math.max(box[3], py);
          }
          if (pixelMax > maxDelta) maxDelta = pixelMax;
        }
        const pixels = source.length / 4;
        return { pixels, hash, identicalBytes: identicalBytes / source.length,
          withinTwo: withinTwo / pixels, maxDelta, differingBox: maxDelta > 2 ? box : null };
      }, { events, original: recording.pixels, xy, height, contactXY, contactPressure, fround, reseed,
        seed: BRISTLE_SEED, exportSource: exportBase64.toString() });
      assert.deepEqual(errors, []);
      await page.close();
      console.log(JSON.stringify({ check: 'replay', variant: name, ...result }));
      return result;
    };

    // Every variant lists what it changes; anything not listed stays float64.
    const float = await replay('float', {});
    const fround = await replay('float32 ticks', { fround: true });
    const pressure = await replay('contact pressure u16', { contactPressure: true });
    const contactXY = await replay('contact xy:64', { contactXY: 64 });
    const spec = await replay('xy:64/h:4096 ticks + contacts', { xy: 64, height: 4096, contactXY: 64, contactPressure: true });
    const fine = await replay('xy:65536 ticks', { xy: 65536 });
    const control = await replay('control: float, no reseed', { reseed: false });
    const codec = await replay('.flus codec round trip', { events: codecEvents });

    assert.equal(float.identicalBytes, 1, 'a float replay after reload is bit-exact');
    // Not bit-exact: Simulator.splat() sizes its CPU-side splat area from the
    // float64 position (Math.ceil of speed padding), so a one-ulp rounding
    // sometimes grows the simulated area by a pixel -- measured as 0-2 bytes
    // off by exactly 1. The GPU itself only ever receives float32.
    assert.ok(fround.withinTwo === 1 && fround.maxDelta <= 1, 'float32 ticks: every pixel within +-1');
    assert.equal(pressure.identicalBytes, 1, 'u16 contact pressure loses nothing');
    assert.ok(codec.withinTwo === 1 && codec.maxDelta <= 1, 'a .flus round trip replays like float32 ticks');
    assert.ok(control.identicalBytes < 1, 'without the bristle seed the replay differs: the probe can see it');
    // Measured, not asserted: below float32 the dynamics are chaotic, so any
    // tick quantum -- even 1/65536 px -- leaves ~7 % of pixels off by > 2.
    console.log(JSON.stringify({ check: 'AC-REC-5 by quantum', spec: spec.withinTwo,
      fine: fine.withinTwo, contactXY: contactXY.withinTwo }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
