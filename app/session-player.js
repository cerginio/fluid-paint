'use strict';

/*
 * Exact replay of a recorded painting session (.flus) in the Player
 * (docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md §2.8, fluid-session
 * phase 4). The records run in order, each tick through engine.replayTick():
 *
 *   begin   -> beginStroke({ ...params, variation })
 *   ticks   -> replayTick(x, y, height, brushSize), one engine step each
 *   contact -> held until the stroke's end
 *   end     -> endStroke({ contact })
 *   idle    -> replayTick() x count, cut to IDLE_LIMIT
 *   command -> the same Paint/engine action the live command ran
 *
 * prepare() puts the engine where the recording started: the painting
 * rectangle and quality of the header, its palette and bristle seed, an empty
 * undo ring, and for Replace an empty wet stage over the baseline PNG.
 * Fluidity and bristle count are the run's (applyRunState), so a user who
 * paints between two runs paints with their own.
 *
 * The cursor -- record index plus offset into a ticks/idle record -- survives
 * a cancelled run, so Resume continues where it stopped. A cancelled run never
 * leaves a stroke open: finishStroke() plays it to its end at once.
 *
 * Vector mode (phase 5, SPEC §2.5) is for a file of another engineContract,
 * whose ticks mean something else to this engine. Its strokes are replayed
 * from the keyframes of section C through the replay-mode strokeTo(): a
 * stroke's ticks only pace it -- tick n sends the keyframes up to t = n --
 * while idle runs and commands play as in Exact mode. The result depends on
 * the keyframes' geometry, not on time; it approximates the recording, and the
 * Thickness multiplier applies to it.
 */
class SessionPlayer {
  constructor(painter, session, { fileName = 'session.flus', byteSize = 0 } = {}) {
    const header = session && session.header;
    if (!header) throw new Error('This session has no header.');
    const exact = header.engineContract === SessionRecorder.ENGINE_CONTRACT;
    if (!exact && !session.keyframes) {
      throw new Error('This session was recorded by a different engine version and has no keyframes to replay approximately.');
    }
    this.mode = exact ? 'exact' : 'vector';
    // Decoded up front: a malformed section must fail Open, not the run.
    this.keyframes = exact ? null : SessionKeyframes.decode(session.keyframes);
    const painting = header.painting;
    if (!painting || !['left', 'bottom', 'width', 'height'].every((key) => Number.isFinite(painting[key])) ||
        painting.width <= 0 || painting.height <= 0) {
      throw new Error('This session does not say where its painting was.');
    }
    this.painter = painter;
    this.engine = painter.engine;
    this.header = header;
    this.baselinePng = session.baselinePng || null;
    this.background = null;   // canvas of the baseline PNG, from load()
    // After the last record the live canvas kept settling on the host's clock;
    // a trailing idle run is that settling, so the replay ends on the same picture.
    this.records = [...session.records, { type: 'idle', count: SessionPlayer.IDLE_LIMIT }];
    let totalTicks = 0;
    let totalStrokes = 0;
    for (const record of this.records) {
      if (record.type === 'ticks' || record.type === 'idle') totalTicks += SessionPlayer._length(record);
      else if (record.type === 'begin') totalStrokes++;
    }
    this.totalTicks = totalTicks;
    this.totalStrokes = totalStrokes;
    if (this.keyframes && this.keyframes.length !== totalStrokes) {
      throw new Error(`This session's keyframes describe ${this.keyframes.length} strokes, its records ${totalStrokes}.`);
    }
    this.summary = {
      fileName,
      byteSize,
      durationSec: header.durationSec || 0,
      strokes: totalStrokes,
      ticks: totalTicks,
      baseline: !!this.baselinePng,
      mode: exact ? 'Exact' : SessionPlayer.VECTOR_LABEL,
    };
    this.thickness = 1;   // Vector only; read at each stroke's begin
    this.runState = null;
    this._storyBaseline = null;
    this.rewind();
  }

  /** Ticks a ticks/idle record replays: idle runs past IDLE_LIMIT change nothing. */
  static _length(record) {
    return record.type === 'ticks' ? record.data.length / 3 : Math.min(record.count, SessionPlayer.IDLE_LIMIT);
  }

  /** Decode the baseline PNG once, so prepare() stays synchronous. */
  async load() {
    if (!this.baselinePng) return this;
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([this.baselinePng], { type: 'image/png' }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (_) {
      throw new Error('The session\'s baseline image could not be decoded.');
    }
    // The same kind of canvas Paint bakes from, so the background texture is
    // uploaded the way the live one was.
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0);
    bitmap.close();
    this.background = canvas;
    return this;
  }

  get done() {
    return this.index >= this.records.length;
  }

  rewind() {
    this.index = 0;
    this.offset = 0;
    this.ticksDone = 0;
    this.strokesDone = 0;
    this.inStroke = false;
    this._contact = null;
    this._brushSize = 0;
    this._vector = null;   // { points, next, tick } of the open Vector stroke
  }

  /** The recording's starting state. `replace` also clears to its baseline. */
  prepare({ replace }) {
    const painter = this.painter;
    const engine = this.engine;
    const header = this.header;
    if (engine.strokeActive) engine.endStroke();
    if (engine.eraseActive) engine.endErase();
    const scale = header.effectiveResolutionScale || header.resolutionScale;
    const maxTexture = engine.capabilities.maxTextureSize;
    if (Math.ceil(header.painting.width * scale) > maxTexture || Math.ceil(header.painting.height * scale) > maxTexture) {
      throw new Error(`This session's ${Math.round(header.painting.width)} × ${Math.round(header.painting.height)} painting is larger than this device can simulate.`);
    }
    painter.placePaintingForReplay(header.painting);
    if (painter.resolutionScale !== header.resolutionScale) {
      painter.setResolutionScale(header.resolutionScale, { snapshot: false });
    }
    if (replace) {
      engine.clear({ dynamics: true });
      if (this.background) engine.setBackgroundImage(this.background);
      else if (engine.renderer.hasBackground) engine.clearBackgroundImage();
    }
    if (header.paletteMode) painter.setPaletteMode(header.paletteMode);
    engine.reseedBristleRandoms(header.bristleSeed);
    painter._resetUndoHistory();
    this.runState = { fluidity: header.fluidity, bristleCount: header.bristleCount };
    this.rewind();
    painter.needsRedraw = true;
  }

  /** Switch the engine to the session's fluidity and bristles; returns the user's. */
  applyRunState() {
    const engine = this.engine;
    const previous = { fluidity: engine.fluidity, bristleCount: engine.bristleCount };
    if (Number.isFinite(this.runState.fluidity)) engine.setSimulation({ fluidity: this.runState.fluidity });
    if (Number.isFinite(this.runState.bristleCount)) engine.setBrush({ bristleCount: this.runState.bristleCount });
    return previous;
  }

  restoreRunState(previous) {
    this.engine.setSimulation({ fluidity: previous.fluidity });
    try {
      this.engine.setBrush({ bristleCount: previous.bristleCount });
    } catch (_) { /* a stroke is open only after an engine error; the next run sets it */ }
  }

  /**
   * Play from the cursor to the end, or until `signal` aborts. `speed()` is
   * read every frame -- a multiplier of 60 ticks/s, or 'max' -- so a speed
   * change re-paces the run instead of restarting it mid-stroke.
   */
  async play({ signal, speed, waitUntilResumed = async () => false,
    waitFrame = () => new Promise(requestAnimationFrame), now = () => performance.now(),
    onTick = () => {}, onFrame = () => {} }) {
    const checkAbort = () => {
      if (signal && signal.aborted) {
        const error = new Error('Session replay was cancelled.');
        error.name = 'AbortError';
        throw error;
      }
    };
    let pace = null;
    const repace = () => {
      const value = speed();
      pace = {
        speed: value,
        time: now(),
        ticks: this.ticksDone,
        // Every speed takes at most what the GPU finishes in a frame; numeric
        // speeds also stop at the clock's deadline.
        scheduler: SessionPlayer.FenceTickScheduler.supported(this.engine.wgl.gl)
          ? new SessionPlayer.FenceTickScheduler(this.engine.wgl.gl, { now })
          : new TilecraftStrokePlayer.BudgetTickScheduler({ now }),
      };
    };
    const dispose = () => { if (pace && pace.scheduler.dispose) pace.scheduler.dispose(); };
    try {
      repace();
      for (;;) {
        checkAbort();
        if (await waitUntilResumed(signal)) { dispose(); repace(); }
        checkAbort();
        if (speed() !== pace.speed) { dispose(); repace(); }
        const scheduler = pace.scheduler;
        scheduler.beginFrame();
        const due = pace.speed === 'max' ? Infinity
          : pace.ticks + Math.floor((now() - pace.time) / 1000 * 60 * pace.speed);
        for (;;) {
          this._runInstant();
          if (this.done || this.ticksDone >= due || !scheduler.shouldContinue()) break;
          this._tick();
          onTick();
        }
        scheduler.endFrame();
        onFrame();
        if (this.done) return;
        await waitFrame();
      }
    } catch (error) {
      if (error.name === 'AbortError') this.finishStroke();
      else if (this.engine.strokeActive) this.engine.endStroke();
      if (error.name !== 'AbortError') this._vector = null;
      throw error;
    } finally {
      dispose();
    }
  }

  /** Run the open stroke to its end at once: a cancelled run cannot leave it open. */
  finishStroke() {
    while (this.inStroke && !this.done) {
      const record = this.records[this.index];
      if (record.type === 'ticks' || record.type === 'idle') {
        if (this.offset < SessionPlayer._length(record)) {
          this._tick();
        } else {
          this.index++;
          this.offset = 0;
        }
        continue;
      }
      this._execute(record);
      this.index++;
    }
  }

  /** Execute records up to the next tick or the end; none of them steps the engine. */
  _runInstant() {
    while (this.index < this.records.length) {
      const record = this.records[this.index];
      if (record.type === 'ticks' || record.type === 'idle') {
        if (this.offset < SessionPlayer._length(record)) return;
        this.index++;
        this.offset = 0;
        continue;
      }
      this._execute(record);
      this.index++;
    }
  }

  /** One engine step: the tick under the cursor. */
  _tick() {
    const record = this.records[this.index];
    if (record.type === 'ticks' && this._vector) {
      this._vector.tick++;
      this._sendKeyframes(this._vector.tick);
    } else if (record.type === 'ticks') {
      const data = record.data;
      const i = this.offset * 3;
      this.engine.replayTick(data[i], data[i + 1], data[i + 2], this._brushSize);
    } else {
      this.engine.replayTick();
    }
    this.offset++;
    this.ticksDone++;
  }

  /* Vector: strokeTo() every keyframe up to tick `upTo`; the replay-mode stroke
   * runs its own steps, one per spacing along the way. */
  _sendKeyframes(upTo) {
    const vector = this._vector;
    const points = vector.points;
    while (vector.next < points.t.length && points.t[vector.next] <= upTo) {
      const i = vector.next++;
      this.engine.strokeTo({ x: points.x[i], y: points.y[i], pressure: points.p[i] });
    }
  }

  _beginVector(record) {
    const points = this.keyframes[this.strokesDone];
    const params = record.params;
    const thickness = this.thickness;
    // The begin point is keyframe 0; beginStroke() settles on it itself.
    this.engine.beginStroke({
      ...params,
      x: points.x[0], y: points.y[0], pressure: points.p[0],
      timing: 'replay',
      brushSize: params.brushSize * thickness,
      spacing: params.spacing === undefined ? undefined : params.spacing * thickness,
      variation: record.variation,
    });
    this._vector = { points, next: 1, tick: 0 };
  }

  _execute(record) {
    switch (record.type) {
      case 'begin':
        if (this.mode === 'vector') this._beginVector(record);
        else this.engine.beginStroke({ ...record.params, variation: record.variation });
        this._brushSize = record.params.brushSize;
        this._contact = null;
        this.inStroke = true;
        break;
      case 'contact':
        this._contact = { x: record.x, y: record.y, pressure: record.pressure };
        break;
      case 'end':
        if (this._vector) {
          this._sendKeyframes(Infinity);
          this._vector = null;
          this.engine.endStroke();
        } else {
          this.engine.endStroke({ contact: this._contact });
        }
        this._contact = null;
        this.inStroke = false;
        this.strokesDone++;
        break;
      case 'command':
        this._command(record.command);
        break;
      default:
        throw new Error(`Session replay: unknown record ${record.type}.`);
    }
    this.painter.needsRedraw = true;
  }

  /* The live command's own action, never the public Paint method: those yield
   * to the Player first, which would cancel this very replay. */
  _command(command) {
    const painter = this.painter;
    const engine = this.engine;
    switch (command.op) {
      case 'snapshot': painter._saveSnapshot(); break;
      case 'undo': painter._undoStep(); break;
      case 'redo': painter._redoStep(); break;
      case 'clear': engine.clear(); break;
      case 'bake': painter._bakeVisiblePainting(); break;
      case 'palette': painter.setPaletteMode(command.mode); break;
      case 'quality': painter.setResolutionScale(command.resolutionScale); break;
      case 'fluidity':
        this.runState.fluidity = command.value;
        engine.setSimulation({ fluidity: command.value });
        break;
      case 'bristles':
        this.runState.bristleCount = command.count;
        engine.setBrush({ bristleCount: command.count });
        break;
      case 'path': engine.paintPathSegment(command.segment); break;
      case 'erase': {
        // Points are a flat [x0, y0, x1, y1, ...] list after the first dab.
        engine.beginErase(command.params);
        const points = command.points;
        for (let i = 0; i + 1 < points.length; i += 2) engine.eraseTo({ x: points[i], y: points[i + 1] });
        engine.endErase();
        break;
      }
      case 'story-baseline': {
        const rectangle = painter.paintingRectangle;
        if (!this._storyBaseline) {
          this._storyBaseline = engine.createSnapshot(rectangle.width, rectangle.height, painter.resolutionScale);
        }
        engine.saveSnapshot(this._storyBaseline, rectangle.width, rectangle.height, painter.resolutionScale);
        break;
      }
      case 'story-restore':
        if (!this._storyBaseline) throw new Error('Session replay: story-restore without a story baseline.');
        painter.applySnapshot(this._storyBaseline);
        break;
      default:
        throw new Error(`Session replay: unknown command ${command.op}.`);
    }
  }
}

/*
 * Ticks per frame bounded by the GPU rather than the display clock. A session
 * tick is a whole brush and fluid step, heavy enough that WebGL queues far
 * more of them than the GPU finishes in a frame: RAF keeps firing at 60 Hz
 * until the queue forces a stall of seconds, which BudgetTickScheduler takes
 * for a hidden tab. Measured on a Radeon 890M at Max: 2.2 s stalls, 46 of 57
 * seconds frozen, the status reading 11 ticks/s at a real 231.
 *
 * A fence after each frame's ticks tells when the GPU caught up. At most
 * `depth` batches are in flight: those waiting keep the GPU fed between frames,
 * and a page sees a fence signal frames after the GPU passed it. 4904 ticks on
 * the 890M: depth 2 -- 42 s, depth 4 -- 25 s, both p90 frame 16.8 ms and none
 * over 83 ms; depth 8 starts to rebuild the queue (p90 33 ms, 200 ms frames).
 * On SwiftShader the fence lags most: depth 2 ran 2.7 ticks/s, depth 4 9.3
 * (fluid-session item 6). A batch done before its successor's frame ends
 * grows the next by one; one the scheduler had to wait for shrinks it to 0.7.
 * The CPU budget still applies. Same protocol as the other schedulers;
 * dispose() drops pending fences.
 */
SessionPlayer.FenceTickScheduler = class {
  static supported(gl) {
    return !!gl && typeof gl.fenceSync === 'function';
  }

  constructor(gl, { now = () => performance.now(), budgetMs = 10, initialLimit = 4, maxLimit = 256,
    depth = 4 } = {}) {
    this.gl = gl;
    this.now = now;
    this.budgetMs = budgetMs;
    this.maxLimit = maxLimit;
    this.depth = depth;
    this.limit = initialLimit;
    this.count = 0;
    this.fences = [];
    this.waited = false;   // a frame was blocked on the oldest fence
    this.blocked = false;
    this._frameStart = 0;
  }

  beginFrame() {
    this.count = 0;
    this._frameStart = this.now();
    const gl = this.gl;
    while (this.fences.length && gl.clientWaitSync(this.fences[0], 0, 0) !== gl.TIMEOUT_EXPIRED) {
      gl.deleteSync(this.fences.shift());
      this.limit = this.waited
        ? Math.max(1, Math.floor(this.limit * 0.7))
        : Math.min(this.maxLimit, this.limit + 1);
      this.waited = false;
    }
    this.blocked = this.fences.length >= this.depth;
    if (this.blocked) this.waited = true;
  }

  shouldContinue() {
    if (this.blocked) return false;
    if (this.count > 0 &&
        (this.count >= this.limit || this.now() - this._frameStart >= this.budgetMs)) {
      return false;
    }
    this.count++;
    return true;
  }

  endFrame() {
    if (this.count === 0) return;
    const gl = this.gl;
    this.fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
    gl.flush();
  }

  dispose() {
    for (const fence of this.fences) this.gl.deleteSync(fence);
    this.fences = [];
  }
};

/* A splat area is simulated while frameNumber - its frame <= 60
 * (FRAMES_TO_SIMULATE, simulation.js), and frameNumber only moves inside a
 * simulate() that ran. An area made outside a tick -- the final contact of
 * endStroke(), a path segment -- therefore needs 61 steps; after them every
 * further idle step returns at once and changes nothing. */
SessionPlayer.IDLE_LIMIT = 61;
SessionPlayer.VECTOR_LABEL = 'Vector — approximate';

if (typeof module !== 'undefined' && module.exports) module.exports = SessionPlayer;
if (typeof globalThis !== 'undefined') globalThis.SessionPlayer = SessionPlayer;
