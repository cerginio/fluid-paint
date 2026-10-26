'use strict';

/*
 * Records a painting session at the engine boundary (SPEC §2.2): the ticks
 * FluidEngine actually ran, stroke boundaries and final contacts from its
 * session observer, and application commands pushed by Paint.
 *
 * Per tick it only writes three floats into a preallocated Float32Array
 * block (PERF-REC-1) and compares the fluidity against the last recorded
 * value; nothing is allocated until a stroke ends. Encoding happens once, on
 * finish -- see SessionCodec.
 *
 * States: idle -> waiting (Record pressed mid-stroke; starts at that stroke's
 * end, SPEC §2.7) -> recording -> stopping (Stop mid-stroke; finishes at its
 * end, AC-REC-3) -> stopped.
 *
 * Fluidity and bristle count are compared against the engine rather than
 * pushed by whoever changed them: story playback sets the bristle count on
 * the engine directly, and either can change between any two ticks.
 */
class SessionRecorder {
  constructor(engine, { tickLimit = SessionRecorder.TICK_LIMIT, blockTicks = 4096,
    now = () => performance.now(), onFinish = () => {} } = {}) {
    this.engine = engine;
    this.tickLimit = tickLimit;
    this.blockTicks = blockTicks;
    this.now = now;
    this.onFinish = onFinish;
    this.state = 'idle';
    this._observer = this._createObserver();
    this._reset();
  }

  _reset() {
    this.records = [];
    this._blocks = [];
    this._tickCount = 0;     // stroke ticks written so far
    this._strokeStart = 0;   // tick index of the open stroke's first tick
    this._pendingIdle = 0;
    this._inStroke = false;
    this.strokes = 0;
    this.idleTicks = 0;
    this.startedAt = 0;
    this.finishedAt = 0;
    this.stopReason = null;
    this.header = null;
    this._lastFluidity = undefined;
    this._lastBristleCount = undefined;
    this._prepare = null;
  }

  get ticks() {
    return this._tickCount;
  }

  get active() {
    return this.state === 'waiting' || this.state === 'recording' || this.state === 'stopping';
  }

  /** False once the engine detached the observer after an error in it. */
  get attached() {
    return this.engine._sessionObserver === this._observer;
  }

  get durationSeconds() {
    if (!this.startedAt) return 0;
    return ((this.finishedAt || this.now()) - this.startedAt) / 1000;
  }

  /**
   * Begin a session. `prepare()` runs when recording actually starts -- at
   * once, or after a stroke already in progress ends -- and returns the
   * header fields describing the starting state (painting, palette, baseline).
   */
  start({ bristleSeed, prepare }) {
    if (this.active) throw new Error('A session is already being recorded.');
    if (!Number.isInteger(bristleSeed) || bristleSeed < 0 || bristleSeed > 0xFFFFFFFF) {
      throw new RangeError('The bristle seed must be a 32-bit unsigned integer.');
    }
    this._reset();
    this.bristleSeed = bristleSeed;
    this._prepare = prepare || (() => ({}));
    this.engine.setSessionObserver(this._observer);
    if (this.engine.strokeActive) {
      this.state = 'waiting';
    } else {
      this._activate();
    }
  }

  _activate() {
    // The jitter of every recorded press comes from this seed, not from the
    // Math.random the page loaded with (phase 2: without it 24 % of pixels
    // differ after reload).
    this.engine.reseedBristleRandoms(this.bristleSeed);
    const prepared = this._prepare() || {};
    this._lastFluidity = this.engine.fluidity;
    this._lastBristleCount = this.engine.bristleCount;
    this.header = {
      ...prepared,
      fluidity: this._lastFluidity,
      bristleCount: this._lastBristleCount,
      bristleSeed: this.bristleSeed,
    };
    this.startedAt = this.now();
    this.created = new Date().toISOString();
    this.state = 'recording';
  }

  /** An application command (Paint): undo, redo, clear, bake, ... */
  command(command) {
    if (this.state !== 'recording' && this.state !== 'stopping') return;
    this._flushIdle();
    this.records.push({ type: 'command', command });
  }

  /**
   * Finish the session. Mid-stroke, the stroke is recorded to its end first
   * (AC-REC-3); `reason` is kept for the card ('stop', 'limit', 'resize' ...).
   */
  stop(reason = 'stop') {
    if (this.state === 'waiting') {
      this.engine.setSessionObserver(null);
      this._reset();
      this.state = 'idle';
      this.onFinish(this, 'cancelled');
      return;
    }
    if (this.state !== 'recording') return;
    this.stopReason = reason;
    if (this._inStroke && this.attached) {
      this.state = 'stopping';
    } else {
      this._finish();
    }
  }

  /** Forget the recording entirely (Discard). */
  discard() {
    if (this.active && this.attached) this.engine.setSessionObserver(null);
    this._reset();
    this.state = 'idle';
  }

  _finish() {
    if (this._inStroke) {
      // Only when the engine detached us mid-stroke: its end will never be
      // reported, and a file must not hold an unterminated stroke.
      this._flushTicks();
      this.records.push({ type: 'end' });
      this._inStroke = false;
    }
    this._flushIdle();
    if (this.attached) this.engine.setSessionObserver(null);
    this.finishedAt = this.now();
    this.state = 'stopped';
    this.onFinish(this, this.stopReason);
  }

  _flushIdle() {
    if (this._pendingIdle === 0) return;
    this.records.push({ type: 'idle', count: this._pendingIdle });
    this._pendingIdle = 0;
  }

  _flushTicks() {
    const count = this._tickCount - this._strokeStart;
    if (count === 0) return;
    const data = new Float32Array(count * 3);
    let written = 0;
    for (let tick = this._strokeStart; tick < this._tickCount;) {
      const block = this._blocks[Math.floor(tick / this.blockTicks)];
      const offset = tick % this.blockTicks;
      const take = Math.min(this.blockTicks - offset, this._tickCount - tick);
      data.set(block.subarray(offset * 3, (offset + take) * 3), written * 3);
      written += take;
      tick += take;
    }
    this.records.push({ type: 'ticks', data });
    this._strokeStart = this._tickCount;
  }

  _checkFluidity() {
    const fluidity = this.engine.fluidity;
    if (fluidity !== this._lastFluidity) {
      this._lastFluidity = fluidity;
      this.command({ op: 'fluidity', value: fluidity });
    }
  }

  _fail(message) {
    // Thrown inside an observer call: the engine detaches the observer and
    // logs it; the card reads `attached` and says the recording stopped.
    throw new Error(`Session recording stopped: ${message}`);
  }

  _createObserver() {
    return {
      onBeginStroke: (params, variation) => {
        if (this.state !== 'recording') return;
        if (params.timing !== 'live') {
          this._fail('a legacy replay stroke runs its steps outside the tick observer.');
        }
        this._checkFluidity();
        const bristleCount = this.engine.bristleCount;
        if (bristleCount !== this._lastBristleCount) {
          this._lastBristleCount = bristleCount;
          this.command({ op: 'bristles', count: bristleCount });
        }
        this._flushIdle();
        this.records.push({ type: 'begin', params, variation });
        this._brushSize = params.brushSize;
        this._inStroke = true;
        this._strokeStart = this._tickCount;
        this.strokes++;
      },

      onTick: (x, y, height, scale) => {
        if (!this._inStroke) return;
        if (scale !== this._brushSize) this._fail('a tick scale differs from the stroke brush size.');
        if (this.engine.fluidity !== this._lastFluidity) {
          this._flushTicks();
          this._checkFluidity();
        }
        const index = this._tickCount % this.blockTicks;
        let block = this._blocks[Math.floor(this._tickCount / this.blockTicks)];
        if (!block) {
          block = new Float32Array(this.blockTicks * 3);
          this._blocks.push(block);
        }
        block[index * 3] = x;
        block[index * 3 + 1] = y;
        block[index * 3 + 2] = height;
        this._tickCount++;
        if (this._tickCount === this.tickLimit && this.state === 'recording') {
          this.stop('limit');
        }
      },

      onIdleTick: () => {
        if (this.state !== 'recording') return;
        if (this.engine.fluidity !== this._lastFluidity) this._checkFluidity();
        this._pendingIdle++;
        this.idleTicks++;
      },

      onContact: (x, y, pressure) => {
        if (!this._inStroke) return;
        this._flushTicks();
        this.records.push({ type: 'contact', x, y, pressure });
      },

      onEndStroke: () => {
        if (this.state === 'waiting') {
          // The engine clears its stroke before this call, so the seed and
          // a baseline can be taken here -- but not inside the notification,
          // which still belongs to endStroke(). No tick runs before a microtask.
          queueMicrotask(() => {
            if (this.state === 'waiting' && !this.engine.strokeActive) this._activate();
          });
          return;
        }
        if (!this._inStroke) return;
        this._flushTicks();
        this.records.push({ type: 'end' });
        this._inStroke = false;
        if (this.state === 'stopping') this._finish();
      },

      onPathSegment: (segment) => {
        if (this.state !== 'recording') return;
        this._checkFluidity();
        // The caller's object: copy it now, it may be reused after this call.
        this.command({ op: 'path', segment: JSON.parse(JSON.stringify(segment)) });
      },
    };
  }

  /** The session for SessionCodec. Only after stop(). */
  toSession({ baselinePng = null, appVersion = '' } = {}) {
    if (this.state !== 'stopped') throw new Error('Stop the recording before saving it.');
    return {
      header: {
        app: 'fluid-paint',
        appVersion,
        engineContract: SessionRecorder.ENGINE_CONTRACT,
        created: this.created,
        durationSec: Math.round(this.durationSeconds * 10) / 10,
        ...this.header,
        baseline: baselinePng ? 'png' : 'empty',
        stats: { strokes: this.strokes, ticks: this._tickCount, idleTicks: this.idleTicks },
        stopReason: this.stopReason,
      },
      baselinePng,
      records: this.records,
    };
  }
}

// 2 h of active painting at 60 ticks/s (PERF-REC-5).
SessionRecorder.TICK_LIMIT = 432000;
// Bumped when a tick no longer means what the recording's engine meant by it.
SessionRecorder.ENGINE_CONTRACT = 1;

if (typeof module !== 'undefined' && module.exports) module.exports = SessionRecorder;
if (typeof globalThis !== 'undefined') globalThis.SessionRecorder = SessionRecorder;
