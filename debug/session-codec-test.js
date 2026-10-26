'use strict';

// fluid-session phase 3: the .flus codec (SessionCodec) and the engine-boundary
// recorder (SessionRecorder), against a fake engine that calls the observer the
// way FluidEngine does. GPU-free; the GPU round trip is in
// debug/session-replay-gpu-test.js.
//
//   node debug/session-codec-test.js
const assert = require('node:assert/strict');
const SessionCodec = require('../app/session-codec.js');
const SessionRecorder = require('../app/session-recorder.js');

const results = [];
async function check(name, body) {
  await body();
  results.push(name);
}

// A fake FluidEngine: just the observer surface the recorder uses.
class FakeEngine {
  constructor() {
    this._sessionObserver = null;
    this.strokeActive = false;
    this.fluidity = 0.8;
    this.bristleCount = 100;
    this.seeds = [];
  }
  setSessionObserver(observer) { this._sessionObserver = observer; }
  reseedBristleRandoms(seed) {
    if (this.strokeActive) throw new Error('reseed during stroke');
    this.seeds.push(seed);
  }
  _call(method, ...args) {
    const observer = this._sessionObserver;
    if (!observer || !observer[method]) return;
    try { observer[method](...args); } catch (error) { this._sessionObserver = null; this.lastError = error; }
  }
  begin(params, variation = 0.25) {
    this.strokeActive = true;
    this.brushSize = params.brushSize;
    this._call('onBeginStroke', { timing: 'live', ...params }, variation);
  }
  tick(x, y, h) {
    this._call(this.strokeActive ? 'onTick' : 'onIdleTick', x, y, h, this.brushSize);
  }
  idle(n) { for (let i = 0; i < n; i++) this._call('onIdleTick'); }
  end(contact) {
    if (contact) this._call('onContact', contact.x, contact.y, contact.pressure);
    this.strokeActive = false;
    this._call('onEndStroke');
  }
}

const strokeParams = (x, y, brushSize = 40) => ({
  x, y, pressure: 0.7, brushSize, resolutionScale: 1, spacing: undefined, randomizeBristles: false,
  paintingRectangle: { left: 60, bottom: 60, width: 1600, height: 1000 },
  color: { space: 'pigment', channels: [0.2, 0.5, 0.9], alpha: 0.8 }, brushShape: null,
});

function flatTicks(records) {
  const values = [];
  for (const record of records) if (record.type === 'ticks') values.push(...record.data);
  return values;
}

(async () => {
  await check('varint and zigzag round-trip at their edges', () => {
    const values = [0, 1, -1, 63, -64, 64, 127, 128, -129, 2 ** 31 - 1, -(2 ** 31), 2 ** 32, -(2 ** 33), 2 ** 33 + 5];
    const records = values.map((count) => ({ type: 'idle', count: Math.abs(count) }));
    const decoded = SessionCodec.decodeBody(SessionCodec.encodeBody({ header: {}, records }));
    assert.deepEqual(decoded.records.map((r) => r.count), values.map(Math.abs));
  });

  await check('float keys order floats and keep -0, denormals and extremes', () => {
    const floats = [-3.4e38, -1, -1e-45, -0, 0, 1e-45, 1, 1234.5678, 3.4e38, Infinity, -Infinity];
    for (const value of floats) {
      const round = SessionCodec.keyFloat(SessionCodec.floatKey(value));
      assert.ok(Object.is(round, Math.fround(value)), `${value} round-trips`);
    }
    const sorted = [-3.4e38, -1, -1e-45, -0, 0, 1e-45, 1, 3.4e38].map(SessionCodec.floatKey);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] > sorted[i - 1], 'keys are monotonic');
    assert.equal(SessionCodec.floatKey(1e-45) - SessionCodec.floatKey(0), 1, 'neighbours differ by one');
  });

  await check('every tag round-trips; ticks come back as the exact float32', async () => {
    const data = new Float32Array([100.1, 200.2, 12.5, 101.7, 203.9, 12.25, 99.9, 207.3, 11.0,
      -5.5, 0, -0, 3e9, -3e9, 1e-40]);
    const session = {
      header: { app: 'fluid-paint', durationSec: 1.5, painting: { width: 1600, height: 1000 } },
      baselinePng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
      records: [
        { type: 'idle', count: 7 },
        { type: 'command', command: { op: 'fluidity', value: 0.42 } },
        { type: 'begin', params: strokeParams(100.123456789, 200.987654321), variation: 0.123456789012345 },
        { type: 'ticks', data: data.slice(0, 9) },
        { type: 'command', command: { op: 'fluidity', value: 0.5 } },
        { type: 'ticks', data: data.slice(9) },
        { type: 'contact', x: 101.00000000001, y: 202.5, pressure: 0.333333333333 },
        { type: 'end' },
        { type: 'command', command: { op: 'path', segment: { from: { x: 1.5, y: 2.25 }, to: { x: 3, y: 4 } } } },
        { type: 'command', command: { op: 'undo' } },
      ],
    };
    const file = await SessionCodec.encode(session);
    assert.deepEqual([...file.slice(0, 6)], [0x46, 0x4C, 0x55, 0x53, 1, 1]);
    const decoded = await SessionCodec.decode(file);
    assert.equal(decoded.header.tickEncoding, 'float32-pred2');
    assert.equal(decoded.header.durationSec, 1.5);
    assert.deepEqual([...decoded.baselinePng], [...session.baselinePng]);
    assert.equal(decoded.records.length, session.records.length);
    for (let i = 0; i < session.records.length; i++) {
      const want = session.records[i];
      const got = decoded.records[i];
      if (want.type === 'ticks') {
        assert.equal(got.data.length, want.data.length);
        for (let j = 0; j < want.data.length; j++) assert.ok(Object.is(got.data[j], want.data[j]), `tick value ${j}`);
      } else {
        // JSON drops an undefined spacing, which the engine treats as omitted.
        assert.deepEqual(got, JSON.parse(JSON.stringify(want)), `record ${i} (${want.type})`);
      }
    }
  });

  await check('a file without a baseline, and damaged files, are told apart', async () => {
    const file = await SessionCodec.encode({ header: {}, records: [] });
    assert.equal(file[5], 0);
    assert.equal((await SessionCodec.decode(file)).baselinePng, null);
    const reject = async (bytes, pattern) => {
      await assert.rejects(SessionCodec.decode(bytes), (error) => error.name === 'SessionFormatError' && pattern.test(error.message));
    };
    await reject(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), /not a Fluid Paint session/);
    const wrongVersion = file.slice(); wrongVersion[4] = 9;
    await reject(wrongVersion, /version 9/);
    const truncated = file.slice(0, file.length - 4);
    await reject(truncated, /damaged|unexpected end/);
    assert.throws(() => SessionCodec.decodeBody(new Uint8Array([2, 0, 0, 0, 0x7B, 0x7D])), /tick encoding/);
  });

  await check('ticks outside a stroke are refused by the encoder', () => {
    assert.throws(() => SessionCodec.encodeBody({ header: {}, records: [{ type: 'ticks', data: new Float32Array(3) }] }),
      /outside a stroke/);
  });

  // --- Recorder against the fake engine --------------------------------------
  const finished = [];
  const newRecorder = (engine, options = {}) => new SessionRecorder(engine, {
    now: () => engine.clock || 0, onFinish: (_, reason) => finished.push(reason), ...options,
  });

  await check('recorder: ticks cross block boundaries, idle runs and commands keep their order', async () => {
    const engine = new FakeEngine();
    const recorder = newRecorder(engine, { blockTicks: 4 });
    recorder.start({ bristleSeed: 7, prepare: () => ({ painting: { width: 1600, height: 1000 } }) });
    assert.equal(recorder.state, 'recording');
    assert.deepEqual(engine.seeds, [7]);
    engine.idle(3);
    recorder.command({ op: 'clear' });
    engine.begin(strokeParams(300, 400));
    const expected = [];
    for (let i = 0; i < 11; i++) {
      const tick = [300 + i * 3.3, 400 + Math.sin(i) * 7.1, 16 + i * 0.01];
      expected.push(...tick.map(Math.fround));
      engine.tick(...tick);
    }
    engine.fluidity = 0.3;           // slider moved between two ticks
    engine.tick(340, 410, 16.2);
    expected.push(...[340, 410, 16.2].map(Math.fround));
    engine.end({ x: 341, y: 411, pressure: 0.5 });
    engine.idle(2);
    engine.bristleCount = 300;       // story playback raises it on the engine
    engine.begin(strokeParams(500, 500, 30));
    engine.end();
    recorder.stop();
    assert.equal(recorder.state, 'stopped');
    assert.equal(engine._sessionObserver, null, 'detached on finish');
    const kinds = recorder.records.map((r) => r.type === 'command' ? r.command.op : r.type);
    assert.deepEqual(kinds, ['idle', 'clear', 'begin', 'ticks', 'fluidity', 'ticks', 'contact', 'end',
      'idle', 'bristles', 'begin', 'end']);
    assert.deepEqual(flatTicks(recorder.records), expected);
    assert.equal(recorder.ticks, 12);
    assert.equal(recorder.idleTicks, 5);
    assert.equal(recorder.strokes, 2);

    const session = recorder.toSession({ appVersion: 'test' });
    assert.equal(session.header.bristleSeed, 7);
    assert.equal(session.header.fluidity, 0.8);
    assert.equal(session.header.engineContract, 1);
    assert.deepEqual(session.header.stats, { strokes: 2, ticks: 12, idleTicks: 5 });
    const decoded = await SessionCodec.decode(await SessionCodec.encode(session));
    assert.deepEqual(flatTicks(decoded.records), expected);
  });

  await check('recorder: Record mid-stroke starts after that stroke; Stop mid-stroke waits for its end', async () => {
    const engine = new FakeEngine();
    engine.begin(strokeParams(10, 10));
    const recorder = newRecorder(engine);
    let prepared = 0;
    recorder.start({ bristleSeed: 9, prepare: () => { prepared++; return {}; } });
    assert.equal(recorder.state, 'waiting');
    assert.deepEqual(engine.seeds, [], 'no reseed while a stroke is active');
    engine.tick(11, 11, 5);
    engine.end({ x: 12, y: 12, pressure: 1 });
    assert.equal(recorder.state, 'waiting', 'starts after the end notification, not inside it');
    await Promise.resolve();
    assert.equal(recorder.state, 'recording');
    assert.deepEqual(engine.seeds, [9]);
    assert.equal(prepared, 1);
    assert.equal(recorder.records.length, 0, 'nothing of the earlier stroke was recorded');

    engine.begin(strokeParams(20, 20));
    engine.tick(21, 21, 5);
    recorder.stop();
    assert.equal(recorder.state, 'stopping');
    engine.tick(22, 22, 5);
    engine.end();
    assert.equal(recorder.state, 'stopped');
    assert.equal(finished.at(-1), 'stop');
    assert.equal(recorder.ticks, 2, 'the stroke under Stop is complete');
  });

  await check('recorder: Stop while waiting cancels; the tick limit stops at the stroke end', () => {
    const engine = new FakeEngine();
    engine.begin(strokeParams(10, 10));
    const waiting = newRecorder(engine);
    waiting.start({ bristleSeed: 1 });
    waiting.stop();
    assert.equal(waiting.state, 'idle');
    assert.equal(engine._sessionObserver, null);
    engine.end();

    const limited = newRecorder(engine, { tickLimit: 5 });
    limited.start({ bristleSeed: 2 });
    engine.begin(strokeParams(10, 10));
    for (let i = 0; i < 8; i++) engine.tick(10 + i, 10, 5);
    assert.equal(limited.state, 'stopping');
    engine.end();
    assert.equal(limited.state, 'stopped');
    assert.equal(limited.stopReason, 'limit');
    assert.equal(limited.ticks, 8);
  });

  await check('recorder: a legacy replay stroke detaches it, and Stop then closes the stroke', () => {
    const engine = new FakeEngine();
    const recorder = newRecorder(engine);
    recorder.start({ bristleSeed: 3 });
    engine.begin(strokeParams(10, 10));
    engine.tick(11, 11, 5);
    engine._call('onEndStroke');
    engine.strokeActive = false;
    engine.strokeActive = true;
    engine._call('onBeginStroke', { ...strokeParams(10, 10), timing: 'replay' }, 0.5);
    assert.equal(engine._sessionObserver, null);
    assert.match(engine.lastError.message, /legacy replay stroke/);
    assert.equal(recorder.attached, false);
    recorder.stop('error');
    assert.equal(recorder.state, 'stopped');
    assert.deepEqual(recorder.records.map((r) => r.type), ['begin', 'ticks', 'end']);
  });

  // --- Size on a synthetic corpus ---------------------------------------------
  await check('size: lossless float32 ticks on a synthetic hand-speed corpus', async () => {
    // Deterministic jittered strokes at 60 ticks/s, sampled the way advance()
    // interpolates between pointer events: lines, arcs, tremor, slow detail
    // and taps, 36 000 stroke ticks in all (10 min of painting).
    let seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    const engine = new FakeEngine();
    const recorder = newRecorder(engine);
    recorder.start({ bristleSeed: 5 });
    let ticks = 0;
    let strokes = 0;
    while (ticks < 36000) {
      const kind = strokes % 5;
      const cx = 200 + random() * 1200;
      const cy = 200 + random() * 700;
      const speed = [6, 4, 3, 1.2, 0][kind];   // px per tick
      const length = kind === 4 ? 0 : 40 + Math.floor(random() * 200);
      engine.begin(strokeParams(cx, cy, 20 + random() * 60));
      let x = cx;
      let y = cy;
      let angle = random() * Math.PI * 2;
      // Pointer events at 8-16 ms: the target moves in steps, interpolated per tick.
      let target = { x, y };
      for (let i = 0; i < length; i++) {
        if (i % 2 === 0) {
          if (kind === 1) angle += 0.05;
          const tremor = kind === 2 ? (random() - 0.5) * 2.5 : 0;
          target = { x: target.x + Math.cos(angle) * speed * 2 + tremor, y: target.y + Math.sin(angle) * speed * 2 + tremor };
        }
        x += (target.x - x) * 0.5;
        y += (target.y - y) * 0.5;
        engine.tick(x, y, 18 + 6 * Math.sin(i / 17));
        ticks++;
      }
      engine.end({ x, y, pressure: 0.6 });
      engine.idle(20 + Math.floor(random() * 100));
      strokes++;
    }
    recorder.stop();
    const session = recorder.toSession();
    const body = SessionCodec.encodeBody(session);
    const file = await SessionCodec.encode(session);
    // The tick payload alone: the same body with every tick record emptied.
    const withoutTicks = SessionCodec.encodeBody({ ...session, records: session.records.map((record) =>
      record.type === 'ticks' ? { type: 'ticks', data: new Float32Array(0) } : record) });
    const tickBytes = (body.length - withoutTicks.length) / recorder.ticks;
    const round = (value) => Math.round(value * 100) / 100;
    const report = { check: 'size', ticks: recorder.ticks, strokes, bodyBytes: body.length, fileBytes: file.length,
      tickBytesPerTick: round(tickBytes), bodyBytesPerTick: round(body.length / recorder.ticks),
      fileBytesPerTick: round(file.length / recorder.ticks),
      fileKBper36000: Math.round(file.length / recorder.ticks * 36000 / 1024) };
    console.log(JSON.stringify(report));
    // SPEC §2.4 budget after the phase 2 decision (float32, lossless).
    assert.ok(tickBytes <= 9, `${tickBytes.toFixed(2)} B/tick of tick payload before gzip`);
    assert.ok(file.length / recorder.ticks * 36000 <= 300 * 1024, 'file within 300 KB per 10 min');
  });

  console.log(`session-codec: ${results.length} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
