'use strict';

// fluid-session phase 5: section C of a .flus (SessionKeyframes) and the
// Vector replay that plays it (SessionPlayer, mode 'vector'), GPU-free. The
// Player runs against a fake painter/engine that logs the calls it receives.
//
//   node debug/session-keyframes-test.js
const assert = require('node:assert/strict');
const SessionCodec = require('../app/session-codec.js');
const SessionRecorder = require('../app/session-recorder.js');
const SessionKeyframes = require('../app/session-keyframes.js');
const SessionPlayer = require('../app/session-player.js');
const { FakeEngine, strokeParams, paintSyntheticCorpus } = require('./session-test-fixtures.js');

const HEIGHT_SCALE = 2;   // FluidEngine.STROKE_HEIGHT_SCALE
const results = [];
async function check(name, body) {
  await body();
  results.push(name);
}

const point = (t, x, y, p = 0.5) => ({ t, x, y, p });

function recordSession(paint) {
  const engine = new FakeEngine();
  const recorder = new SessionRecorder(engine, { now: () => 0 });
  recorder.start({ bristleSeed: 9, prepare: () => ({
    painting: { left: 60, bottom: 60, width: 1600, height: 1000 }, resolutionScale: 1, paletteMode: 'natural',
  }) });
  paint(engine, recorder);
  recorder.stop();
  return recorder.toSession();
}

// A painter and engine that log what a SessionPlayer asks of them.
function fakeHost() {
  const calls = [];
  let stroke = null;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, ALREADY_SIGNALED: 3,
    fenceSync: () => ({}), clientWaitSync: () => 3, deleteSync() {}, flush() {},
  };
  const engine = {
    wgl: { gl },
    capabilities: { maxTextureSize: 8192 },
    renderer: { hasBackground: false },
    fluidity: 0.8,
    bristleCount: 100,
    get strokeActive() { return stroke !== null; },
    beginStroke(params) {
      if (stroke) throw new Error('stroke already active');
      stroke = params;
      calls.push(['begin', params]);
    },
    strokeTo(target) {
      if (!stroke || stroke.timing !== 'replay') throw new Error('strokeTo outside a replay stroke');
      // The stroke tick the Player is on: a keyframe is due at its own t.
      calls.push(['to', target, host.player && host.player._vector.tick]);
    },
    endStroke(options) {
      calls.push(['end', options]);
      stroke = null;
    },
    replayTick(...args) {
      if (stroke && stroke.timing !== 'live') throw new Error('replayTick() cannot run a legacy replay stroke.');
      calls.push(['tick', args]);
    },
    clear(options) { calls.push(['clear', options]); },
    clearBackgroundImage() {},
    reseedBristleRandoms(seed) { calls.push(['seed', seed]); },
    setSimulation({ fluidity }) { this.fluidity = fluidity; },
    setBrush({ bristleCount }) { this.bristleCount = bristleCount; },
  };
  const painter = {
    engine, resolutionScale: 1, needsRedraw: false,
    placePaintingForReplay() {}, setResolutionScale() {}, setPaletteMode() {}, _resetUndoHistory() {},
    _undoStep() { calls.push(['undo']); },
  };
  const host = { painter, engine, calls, player: null };
  return host;
}

async function playAll(player) {
  let clock = 0;
  await player.play({ speed: () => 'max', waitFrame: async () => {}, now: () => (clock += 0.01) });
}

(async () => {
  await check('RDP keeps the ends and only the corners beyond epsilon', () => {
    const line = Array.from({ length: 50 }, (_, i) => point(i, i * 3, 100 + (i % 2) * 0.4));
    assert.deepEqual(SessionKeyframes.simplify(line), [0, 49], 'wiggle under 0.5 px is dropped');
    const corner = [...Array.from({ length: 20 }, (_, i) => point(i, i * 5, 0)),
      ...Array.from({ length: 20 }, (_, i) => point(20 + i, 95, (i + 1) * 5))];
    assert.deepEqual(SessionKeyframes.simplify(corner), [0, 19, 39]);
    const bump = [point(0, 0, 0), point(1, 10, 0.6), point(2, 20, 0)];
    assert.deepEqual(SessionKeyframes.simplify(bump), [0, 1, 2], '0.6 px off the chord is kept');
    assert.deepEqual(SessionKeyframes.simplify([point(0, 5, 5)]), [0], 'a tap is one point');
  });

  await check('pressure keeps steps over 0.02 and turning points, not float noise', () => {
    // Steps of 1/64 (exact in binary): two of them pass 0.02.
    const ramp = Array.from({ length: 21 }, (_, i) => point(i, i * 2, 0, 0.25 + i / 64));
    assert.deepEqual(SessionKeyframes.simplify(ramp), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20], 'a point every 1/32');
    // A peak of +0.015: under the step, but a turning point.
    const peak = [0.5, 0.505, 0.51, 0.515, 0.51, 0.505, 0.5, 0.5].map((p, i) => point(i, i * 2, 0, p));
    assert.deepEqual(SessionKeyframes.simplify(peak), [0, 3, 7]);
    const noisy = Array.from({ length: 40 }, (_, i) => point(i, i * 2, 0, 0.5 + ((i * 7919) % 13 - 6) * 1e-4));
    assert.deepEqual(SessionKeyframes.simplify(noisy), [0, 39], 'noise under the hysteresis keeps no point');
  });

  await check('stroke points: begin at t 0, a tick per t, the contact at the last tick, pressure from height', () => {
    const session = recordSession((engine) => {
      engine.begin(strokeParams(100, 200, 40));
      engine.tick(110, 200, 2 * 40 * 0.25);
      engine.tick(120, 200, 2 * 40 * 0.5);
      engine.end({ x: 121, y: 201, pressure: 0.4 });
      engine.idle(5);
      engine.begin(strokeParams(300, 300, 20));   // a tap
      engine.end();
    });
    const strokes = SessionKeyframes.strokePoints(session.records, HEIGHT_SCALE);
    assert.equal(strokes.length, 2);
    assert.deepEqual(strokes[0].map((p) => p.t), [0, 1, 2, 2]);
    assert.deepEqual(strokes[0].map((p) => p.p), [0.7, 0.25, 0.5, 0.4]);
    assert.deepEqual(strokes[1], [point(0, 300, 300, 0.7)]);
  });

  await check('build and decode: integer deltas, back within the quanta, begin is the ordinal', () => {
    const session = recordSession((engine) => {
      engine.begin(strokeParams(100.3, 200.7, 40));
      for (let i = 1; i <= 30; i++) engine.tick(100.3 + i * 4.1, 200.7 + Math.sin(i / 3) * 20, 2 * 40 * (0.3 + i / 100));
      engine.end({ x: 230.1, y: 210.2, pressure: 0.2 });
      engine.begin(strokeParams(10, 10, 40));
      engine.end();
    });
    const section = SessionKeyframes.build(session.records, { heightScale: HEIGHT_SCALE });
    assert.deepEqual(section.quanta, { xy: 64, p: 4096 });
    for (const stroke of section.strokes) {
      for (const key of ['t', 'x', 'y', 'p']) assert.ok(stroke[key].every(Number.isInteger), `${key} integers`);
    }
    const decoded = SessionKeyframes.decode(JSON.parse(JSON.stringify(section)));
    assert.deepEqual(decoded.map((s) => s.begin), [0, 1]);
    const original = SessionKeyframes.strokePoints(session.records, HEIGHT_SCALE)[0];
    const kept = SessionKeyframes.simplify(original);
    assert.deepEqual(decoded[0].t, kept.map((i) => original[i].t));
    kept.forEach((index, i) => {
      assert.ok(Math.abs(decoded[0].x[i] - original[index].x) <= 1 / 128 + 1e-9);
      assert.ok(Math.abs(decoded[0].y[i] - original[index].y) <= 1 / 128 + 1e-9);
      assert.ok(Math.abs(decoded[0].p[i] - original[index].p) <= 1 / 8192 + 1e-9);
    });
    assert.equal(decoded[0].x.at(-1), Math.round(230.1 * 64) / 64, 'the contact is the last point');
  });

  await check('decode refuses malformed sections', () => {
    const good = { strokes: [{ begin: 0, t: [0, 3], x: [64, 64], y: [0, 0], p: [2048, 0] }] };
    assert.doesNotThrow(() => SessionKeyframes.decode(good));
    const broken = [
      null, {}, { strokes: [{ begin: 0, t: [0], x: [1, 2], y: [0], p: [0] }] },
      { strokes: [{ begin: 0, t: [], x: [], y: [], p: [] }] },
      { strokes: [{ begin: 0, t: [0, 1.5], x: [0, 0], y: [0, 0], p: [0, 0] }] },
      { strokes: [{ begin: 0, t: [5, -1], x: [0, 0], y: [0, 0], p: [0, 0] }] },
      { strokes: [{ begin: 1, t: [0], x: [0], y: [0], p: [0] }] },
    ];
    for (const section of broken) {
      assert.throws(() => SessionKeyframes.decode(section), { name: 'SessionFormatError' }, JSON.stringify(section));
    }
  });

  await check('codec: section C round-trips and sets flag 1; without it keyframes is null', async () => {
    const session = recordSession((engine) => {
      engine.begin(strokeParams(100, 100));
      engine.tick(120, 100, 30);
      engine.end();
    });
    const plain = await SessionCodec.decode(await SessionCodec.encode(session));
    assert.equal(plain.keyframes, null);
    assert.equal(plain.hasKeyframes, false);
    session.keyframes = SessionKeyframes.build(session.records, { heightScale: HEIGHT_SCALE });
    const file = await SessionCodec.encode(session);
    assert.equal(file[5] & 2, 2);
    const decoded = await SessionCodec.decode(file);
    assert.deepEqual(decoded.keyframes, session.keyframes);
    assert.equal(decoded.hasKeyframes, true);
    assert.equal(decoded.records.length, session.records.length, 'the section is no record');
  });

  await check('size: keyframes per tick and the file budget with section C, synthetic corpus', async () => {
    const session = recordSession((engine) => paintSyntheticCorpus(engine, 36000));
    const ticks = session.header.stats.ticks;
    const started = performance.now();
    const section = SessionKeyframes.build(session.records, { heightScale: HEIGHT_SCALE });
    const buildMs = performance.now() - started;
    const points = section.strokes.reduce((sum, stroke) => sum + stroke.t.length, 0);
    const withSection = await SessionCodec.encode({ ...session, keyframes: section });
    const without = await SessionCodec.encode(session);
    const report = { check: 'keyframes', ticks, strokes: section.strokes.length, points,
      ticksPerPoint: Math.round(ticks / points * 100) / 100,
      sectionJsonBytes: JSON.stringify(section).length,
      fileBytesAdded: withSection.length - without.length, buildMs: Math.round(buildMs) };
    report.fileKBper36000 = Math.round(withSection.length / ticks * 36000 / 1024);
    console.log(JSON.stringify(report));
    // SPEC's 5-10x is for hand strokes (the QA corpus, measured in the UI
    // probe). This corpus swings the pressure over 0.3 every 1.8 s, and the
    // 0.02 pressure step keeps a point every 2-3 ticks of it: 4.6 measured,
    // 10.4 without the pressure rules. The bound only catches a regression.
    assert.ok(ticks / points >= 4, `${(ticks / points).toFixed(2)} ticks per keyframe`);
    assert.ok(withSection.length / ticks * 36000 <= 300 * 1024, 'AC-REC-6: file with section C within 300 KB per 10 min');
  });

  await check('Vector replay: replay-mode strokes through strokeTo, paced by ticks, thickness applied', async () => {
    const session = recordSession((engine, recorder) => {
      engine.idle(3);
      engine.begin({ ...strokeParams(100, 100, 40), spacing: 6 });
      for (let i = 1; i <= 20; i++) engine.tick(100 + i * 5, 100 + (i > 10 ? (i - 10) * 5 : 0), 2 * 40 * 0.5);
      engine.end({ x: 201, y: 150, pressure: 0.3 });
      recorder.command({ op: 'undo' });
      engine.begin(strokeParams(500, 500, 20));   // a tap
      engine.end();
    });
    session.header.engineContract = SessionRecorder.ENGINE_CONTRACT + 1;
    session.keyframes = SessionKeyframes.build(session.records, { heightScale: HEIGHT_SCALE });
    const host = fakeHost();
    const player = new SessionPlayer(host.painter, session, { fileName: 'other.flus' });
    host.player = player;
    assert.equal(player.mode, 'vector');
    assert.equal(player.summary.mode, 'Vector — approximate');
    player.thickness = 1.5;
    player.prepare({ replace: true });
    host.calls.length = 0;
    await playAll(player);
    const kinds = host.calls.map(([kind]) => kind);
    assert.deepEqual(kinds.slice(0, 4), ['tick', 'tick', 'tick', 'begin'], 'the idle run, then the stroke');
    const [, begin] = host.calls[3];
    assert.equal(begin.timing, 'replay');
    assert.equal(begin.brushSize, 60);
    assert.equal(begin.spacing, 9);
    assert.equal(begin.variation, 0.25);
    assert.deepEqual([begin.x, begin.y, begin.pressure], [100, 100, Math.round(0.7 * 4096) / 4096]);
    const firstEnd = kinds.indexOf('end');
    const targets = host.calls.slice(4, firstEnd).map(([, target]) => target);
    assert.ok(host.calls.slice(4, firstEnd).every(([kind]) => kind === 'to'), 'no tick inside a replay stroke');
    // Corner at tick 10, the pressure step at tick 1 (0.7 -> 0.5), the end, the contact.
    assert.deepEqual(targets.map((t) => [t.x, t.y]), [[105, 100], [150, 100], [200, 150], [201, 150]]);
    assert.deepEqual(host.calls.slice(4, firstEnd).map(([, , tick]) => tick), [1, 10, 20, 20],
      'each keyframe on the tick it was recorded at; the contact with the last tick');
    assert.equal(targets.at(-1).pressure, Math.round(0.3 * 4096) / 4096);
    assert.equal(host.calls[firstEnd][1], undefined, 'a replay-mode endStroke takes no contact');
    assert.deepEqual(kinds.slice(firstEnd, firstEnd + 3), ['end', 'undo', 'begin']);
    assert.equal(kinds[firstEnd + 3], 'end', 'a tap: begin, then end');
    assert.equal(kinds.slice(firstEnd + 4).length, SessionPlayer.IDLE_LIMIT, 'the trailing settle');
    assert.equal(player.ticksDone, player.totalTicks);
    assert.equal(player.strokesDone, 2);
  });

  await check('Vector: a cancelled run finishes the open stroke; Exact files stay Exact', async () => {
    const session = recordSession((engine) => {
      engine.begin(strokeParams(100, 100, 40));
      for (let i = 1; i <= 40; i++) engine.tick(100 + i * 3, 100 + (i % 7), 40);
      engine.end();
    });
    const exact = new SessionPlayer(fakeHost().painter, session);
    assert.equal(exact.mode, 'exact');
    session.header.engineContract = 99;
    session.keyframes = SessionKeyframes.build(session.records, { heightScale: HEIGHT_SCALE });
    const host = fakeHost();
    const player = new SessionPlayer(host.painter, session);
    player.prepare({ replace: false });
    const controller = new AbortController();
    let frames = 0;
    await assert.rejects(player.play({
      signal: controller.signal, speed: () => 1, now: () => frames * 1000 / 60,
      waitFrame: async () => { if (++frames === 10) controller.abort(); },
    }), { name: 'AbortError' });
    assert.equal(host.engine.strokeActive, false);
    assert.equal(player.inStroke, false);
    assert.equal(host.calls.filter(([kind]) => kind === 'end').length, 1);
  });

  await check('another engine without section C, or a section that does not match, is a clear error', () => {
    const session = recordSession((engine) => {
      engine.begin(strokeParams(100, 100));
      engine.end();
    });
    session.header.engineContract = 2;
    assert.throws(() => new SessionPlayer(fakeHost().painter, session), /different engine version and has no keyframes/);
    session.keyframes = { strokes: [] };
    assert.throws(() => new SessionPlayer(fakeHost().painter, session), /keyframes describe 0 strokes, its records 1/);
    session.keyframes = { strokes: [{ begin: 0, t: [0], x: ['a'], y: [0], p: [0] }] };
    assert.throws(() => new SessionPlayer(fakeHost().painter, session), { name: 'SessionFormatError' });
  });

  console.log(`session-keyframes: ${results.length} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
