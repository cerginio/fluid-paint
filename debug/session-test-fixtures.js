'use strict';

// Shared by the GPU-free session tests (session-codec-test, session-keyframes-test):
// a fake FluidEngine with just the observer surface SessionRecorder uses, and
// the synthetic hand-speed corpus both measure on.

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

/*
 * Deterministic jittered strokes at 60 ticks/s, sampled the way advance()
 * interpolates between pointer events: lines, arcs, tremor, slow detail and
 * taps, until `targetTicks` stroke ticks (36 000 = 10 min of painting).
 * Drives `engine`; the caller starts and stops the recorder. Returns the
 * stroke count.
 */
function paintSyntheticCorpus(engine, targetTicks = 36000) {
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  let ticks = 0;
  let strokes = 0;
  while (ticks < targetTicks) {
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
  return strokes;
}

module.exports = { FakeEngine, strokeParams, paintSyntheticCorpus };
