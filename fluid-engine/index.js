// FluidEngine -- the public surface of the engine.
//
// Phase 5. Before this, a host reached into Simulator, Brush and
// PaintingRenderer directly: it read `simulator.resolutionWidth`, wrote
// `simulator.fluidity`, bound `brush.brushIndexBuffer` into its own draw calls,
// and had to know that snapshot textures must match `simulator.paintTextureType`
// or undo would break. Every one of those is a detail a second host would have
// to rediscover, and any of them changing would break it silently.
//
// This is the whole surface. If a host needs something not here, the API is
// wrong and should grow deliberately -- not be worked around by reaching past
// it, which is what `engine.simulator` would invite. There is no such property.
//
// What the engine does NOT own, on purpose:
//
//   - The RAF loop. `frame()` advances one step; when to call it is the host's.
//   - Undo/redo policy. The engine produces and reloads snapshots; how many to
//     keep and when to take them is a product decision. See createSnapshot().
//   - Canvas sizing and DPR. The host owns the canvas; it tells the engine what
//     rectangle to paint into.
//   - Anything drawn over the painting -- panels, pickers, cursors, shadows.

// The Simulator's render targets that scale with the painting resolution:
// paint, paintTemp, velocity, velocityTemp, divergence, pressure, pressureTemp.
// The app cannot know this number without reading simulation.js, which is why
// the memory estimate is the engine's to answer.
const SIMULATION_RENDER_TARGETS = 7;

// Bytes per texel of a 32-bit float RGBA target. Half-float targets are half
// this, so the estimate is a ceiling, which is the useful direction to err.
const BYTES_PER_RGBA_TEXEL = 16;

/*
 * Phase 9a stroke dynamics. These were duplicated in every host that painted;
 * the named API owns them now. They are VERSIONED constants -- changing one
 * changes the look of every stroke, so do not tune them to make a single
 * test pass. The low-level primitives are unaffected.
 */
const STROKE_HEIGHT_SCALE = 2.0;      // brush height over the canvas
const STROKE_MIN_PRESSURE = 0.15;     // a light touch still paints
const STROKE_Z_THRESHOLD = 0.13333;   // bristle contact depth
const STROKE_SPLAT_RADIUS = 0.05;
const STROKE_VELOCITY_SCALE = 0.14;
const STROKE_SETTLE_STEPS = 10;       // matches the harness's ten-RAF wait
const STROKE_SPACING_FRACTION = 0.15; // 7.5 engine px at brush size 50
const STROKE_MIN_SPACING = 1;         // never below one engine pixel

/*
 * The engine's own shader files, relative to fluid-engine/.
 *
 * Phase 9 finding. Until the second host existed this list lived only in the
 * app's common.js as ENGINE_SHADERS, which meant a host had to carry an
 * inventory of the ENGINE's internals: nineteen filenames it has no reason to
 * know, that go stale the moment a pass is added, and whose failure mode is a
 * shader compiled from `undefined` deep inside a constructor rather than a
 * named error. The engine knows which shaders it needs; it should say so.
 *
 * This is a manifest, not a loader. The engine still does no I/O -- the host
 * fetches these however it likes and hands back the sources -- because a host
 * may bundle them, inline them, or serve them from somewhere the engine cannot
 * guess. See FluidEngine.SHADER_FILES and the note on loadShaderTrees().
 */
const ENGINE_SHADER_FILES = Object.freeze([
  'shaders/splat.vert', 'shaders/splat.frag',
  'shaders/fullscreen.vert',
  'shaders/advect.frag',
  'shaders/divergence.frag',
  'shaders/jacobi.frag',
  'shaders/subtract.frag',
  'shaders/resize.frag',

  'shaders/project.frag',
  'shaders/distanceconstraint.frag',
  'shaders/planeconstraint.frag',
  'shaders/bendingconstraint.frag',
  'shaders/setbristles.frag',
  'shaders/updatevelocity.frag',

  'shaders/brush.vert', 'shaders/brush.frag',
  'shaders/painting.vert', 'shaders/painting.frag',
  'shaders/output.frag',
]);

/*
 * Which colour model the painting is composited in.
 *
 * Phase 9 finding. `renderToTexture({ colorModel })` has always been an engine
 * parameter, but the only public NAME for its two values lived in the app's
 * paint-setup.js, while the renderer compared against a private literal. So a
 * second host had to pass a bare number or copy the app's enum -- and the
 * failure mode is silent, because every value that is not exactly RGB falls
 * through to the RYB branch. A host that passed the string 'rgb' would get the
 * subtractive model with no error anywhere.
 *
 * RYB is David Li's subtractive pigment cube and the default; RGB is the
 * additive comparison. The RYB path is protected -- see §3b of the plan and
 * docs/COLOR-MODEL.md. Do not "fix" RYB into RGB.
 */
const COLOR_MODEL = Object.freeze({
  RYB: 0,
  RGB: 1,
});

/**
 * An opaque handle to a saved paint state.
 *
 * The host holds these and decides how many to keep; it must not read or
 * rebuild the texture inside. `paintingWidth`/`paintingHeight`/`resolutionScale`
 * are readable because the host needs them to restore its own painting
 * rectangle and quality setting alongside the pixels -- restoring the paint
 * without them would show the old painting at the new size.
 */
class PaintSnapshot {
  constructor(texture, paintingWidth, paintingHeight, resolutionScale) {
    this.texture = texture;
    this.paintingWidth = paintingWidth;
    this.paintingHeight = paintingHeight;
    this.resolutionScale = resolutionScale;
  }

  getTextureWidth() {
    return Math.ceil(this.paintingWidth * this.resolutionScale);
  }

  getTextureHeight() {
    return Math.ceil(this.paintingHeight * this.resolutionScale);
  }
}

class FluidEngine {
  /**
   * @param {WrappedGL} wgl
   * @param {Object} shaderSources  merged sources; see loadShaderTrees()
   * @param {Object} options
   * @param {number} options.resolutionWidth   initial simulation width, texels
   * @param {number} options.resolutionHeight  initial simulation height, texels
   * @param {number} options.maxBristleCount
   * @param {boolean} [options.blackPigment=true]  which all-three-pigments
   *   corner the cube uses. Defaults to TRUE BLACK (0, 0, 0).
   *
   *   Pass false for David Li's original near-black brown (0.2, 0.094, 0).
   *   That cube contains no black anywhere -- full load on every pigment is
   *   the darkest paint it can make, and the lighting term only brightens --
   *   so a picker built on it has no black to offer at all, which is why black
   *   is the default here.
   *
   *   The blast radius is small and measured: only the x*y*z term of the
   *   trilinear interpolation reads this corner, so every pure hue and every
   *   two-pigment mix (orange, green, purple) is bit-identical either way.
   *   Deltas appear only where all three pigments are present -- 6/255 at a
   *   middling three-way mix, 51/255 at the corner itself.
   *
   *   Fixed at construction; see PaintingRenderer for why it cannot flip
   *   mid-session.
   */
  constructor(wgl, shaderSources, { resolutionWidth, resolutionHeight, maxBristleCount, blackPigment, random }) {
    this.wgl = wgl;

    /* Phase 8a. Captured once so a host that swaps Math.random after
     * construction cannot make one engine nondeterministic halfway through.
     * A host using ?seed= installs its Math.random BEFORE the engine is
     * built, so it keeps working untouched. */
    this.random = typeof random === 'function' ? random : Math.random;

    this.simulator = new Simulator(wgl, shaderSources, resolutionWidth, resolutionHeight);
    this.brush = new Brush(wgl, shaderSources, maxBristleCount, this.random);
    this.renderer = new PaintingRenderer(wgl, shaderSources, { blackPigment: blackPigment });

    /* Hosts (and the UI's colour conversion) need to know which cube is live.
     * Same `=== false` care as the renderer: an omitted option means default. */
    this.blackPigment = blackPigment !== false;

    // The honesty surface. Computed once here rather than re-derived by each
    // host -- the diag panel and the startup gate previously asked these
    // questions separately, which is how the two managed to disagree about
    // whether the iPhone could paint.
    //
    // canDepositPaint is the one that matters: a device can pass every other
    // check and still silently drop the blended splat. See docs/HANDOFF.md.
    this.capabilities = Object.freeze({
      webglVersion: wgl.isWebGL2 ? 2 : 1,
      floatLinear: !!wgl.getExtension('OES_texture_float_linear'),
      floatBlend: !!wgl.getExtension('EXT_float_blend'),
      maxTextureSize: wgl.getParameter(wgl.MAX_TEXTURE_SIZE),
      paintTextureType: this.simulator.paintTextureType,
      // False when neither float nor half-float will blend. A host that ignores
      // this shows a healthy-looking canvas that cannot be painted on, which
      // was the worst part of the iPhone 14 bug.
      canDepositPaint: this.simulator.canDepositPaint !== false,
    });
  }

  // --- Simulation state -------------------------------------------------

  /** Simulation resolution in texels. Read-only. */
  get resolutionWidth() {
    return this.simulator.resolutionWidth;
  }

  get resolutionHeight() {
    return this.simulator.resolutionHeight;
  }

  /**
   * Named simulation parameters. Additive by design: a new parameter is a new
   * key, never a new positional argument, so this signature does not break.
   *
   * @param {Object} params
   * @param {number} [params.fluidity]
   */
  setSimulation({ fluidity } = {}) {
    if (fluidity !== undefined) this.simulator.fluidity = fluidity;
  }

  /** Current fluidity, so a host control can initialise itself from the engine
   *  rather than hardcoding a default that could drift from the real one. */
  get fluidity() {
    return this.simulator.fluidity;
  }

  /**
   * Named brush parameters, same additive contract as setSimulation().
   *
   * @param {Object} params
   * @param {number} [params.bristleCount]
   */
  setBrush({ bristleCount } = {}) {
    this._assertNoStroke('setBrush()');
    if (bristleCount !== undefined) this.brush.setBristleCount(bristleCount);
  }

  /** Bristle counts the splat alpha curve is scaled against. */
  get bristleCount() {
    return this.brush.bristleCount;
  }

  get maxBristleCount() {
    return this.brush.maxBristleCount;
  }

  // --- Strokes ----------------------------------------------------------

  /**
   * Place the brush without depositing paint. Coordinates are in whatever space
   * the host's painting rectangle is expressed in; the engine only requires
   * that the two agree. See splat()'s note on brush space.
   */
  positionBrush(x, y, height, scale) {
    this._assertNoStroke('positionBrush()');
    this.brush.update(x, y, height, scale);
  }

  /**
   * Place and reseed the bristles at a position, drawing this press's Phase 8a
   * layout variation. It does NOT settle them: settling needs repeated
   * positionBrush() calls, which callers of this low-level primitive must
   * advance themselves. beginStroke() is the public operation that owns both.
   *
   * brushShape is optional and mirrors beginStroke()'s handling: selecting the
   * footprint before initialize() (which draws the bristles), and restoring
   * the round default when omitted so a caller that never asks for a shape
   * keeps behaving exactly as before this parameter existed.
   */
  initializeBrush(x, y, height, scale, brushShape) {
    this._assertNoStroke('initializeBrush()');
    if (typeof this.brush.setBristleShape === 'function') {
      this.brush.setBristleShape(brushShape);
    } else if (brushShape) {
      throw this._strokeError('FluidEngine: this brush does not support brushShape.');
    }
    this.brush.initialize(x, y, height, scale);
  }

  /**
   * Deposit paint where the bristles cross the painting.
   *
   * @param {Rectangle} brushRectangle  the painting, in the brush's own space
   * @param {number[]}  color           RYB or RGB triple plus alpha
   */
  splat(brushRectangle, { zThreshold, color, radius, velocityScale }) {
    this._assertNoStroke('splat()');
    this.simulator.splat(this.brush, zThreshold, brushRectangle, color, radius, velocityScale);
  }

  /** Advance the fluid one step. Returns whether anything actually moved. */
  frame() {
    this._assertNoStroke('frame()');
    return this.simulator.simulate();
  }

  // --- Named stroke API (Phase 9a) --------------------------------------
  //
  // timing:'live' uses a latest-input mailbox and advance(now) at 60 ticks/s.
  // The default 'replay' preserves the old synchronous spatial replay API for
  // existing offline callers. Never use that mode for interactive painting.
  // Low-level primitives are guarded during either mode; use advance() for
  // live strokes, and let the synchronous replay own its steps.

  /** True while a named stroke is running. */
  get strokeActive() {
    return this._stroke !== null && this._stroke !== undefined;
  }

  _strokeError(message) {
    const error = new Error(message);
    error.name = 'StrokeStateError';
    return error;
  }

  /* Guard for the low-level primitives and for anything that would change the
   * geometry a stroke already snapshotted. */
  _assertNoStroke(what) {
    if (this.strokeActive) {
      throw this._strokeError(
        `FluidEngine: ${what} is not allowed while a named stroke is active; ` +
        'call endStroke() first.'
      );
    }
  }

  _validateNumber(value, name, { min, max, positive } = {}) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw this._strokeError(`FluidEngine: ${name} must be a finite number, got ${value}.`);
    }
    if (positive && value <= 0) {
      throw this._strokeError(`FluidEngine: ${name} must be greater than zero, got ${value}.`);
    }
    if (min !== undefined && value < min) {
      throw this._strokeError(`FluidEngine: ${name} must be >= ${min}, got ${value}.`);
    }
    if (max !== undefined && value > max) {
      throw this._strokeError(`FluidEngine: ${name} must be <= ${max}, got ${value}.`);
    }
    return value;
  }

  /**
   * Begin a stroke. Live mode reseeds and makes one contact without advancing
   * time; legacy replay mode settles synchronously for offline compatibility.
   * @param {object} options Pass timing:'live' in interactive hosts.
   */
  beginStroke({ x, y, pressure = 1, brushSize, paintingRectangle, color, resolutionScale = 1, spacing, timing = 'replay', brushShape = null }) {
    if (this.strokeActive) {
      throw this._strokeError('FluidEngine: a stroke is already active; call endStroke() first.');
    }

    if (timing !== 'live' && timing !== 'replay') throw this._strokeError('Unknown stroke timing.');

    // Everything below runs BEFORE any GPU mutation or random draw, so a
    // rejected begin leaves the engine idle and consumes no variation.
    this._validateNumber(x, 'x');
    this._validateNumber(y, 'y');
    this._validateNumber(pressure, 'pressure', { min: 0, max: 1 });
    this._validateNumber(brushSize, 'brushSize', { positive: true });
    this._validateNumber(resolutionScale, 'resolutionScale', { positive: true });
    if (spacing !== undefined) this._validateNumber(spacing, 'spacing', { positive: true });
    if (brushShape !== null && brushShape !== undefined) {
      if (typeof brushShape !== 'object') {
        throw this._strokeError('FluidEngine: brushShape must be an object or null.');
      }
      this._validateNumber(brushShape.sides, 'brushShape.sides', { min: 3, max: 8 });
      if (brushShape.aspect !== undefined) {
        this._validateNumber(brushShape.aspect, 'brushShape.aspect', { positive: true });
      }
      if (brushShape.rotation !== undefined) {
        this._validateNumber(brushShape.rotation, 'brushShape.rotation');
      }
    }

    if (!paintingRectangle) {
      throw this._strokeError('FluidEngine: paintingRectangle is required.');
    }
    this._validateNumber(paintingRectangle.width, 'paintingRectangle.width', { positive: true });
    this._validateNumber(paintingRectangle.height, 'paintingRectangle.height', { positive: true });
    this._validateNumber(paintingRectangle.left, 'paintingRectangle.left');
    this._validateNumber(paintingRectangle.bottom, 'paintingRectangle.bottom');

    if (!color || color.space !== 'pigment') {
      // Deliberately loud: an RGB triple would mix plausibly but wrongly, and
      // the picker bugs of Phases 8-10 were all this failure wearing a hat.
      throw this._strokeError(
        "FluidEngine: color.space must be the literal 'pigment'; got " +
        (color ? String(color.space) : 'no color object') +
        '. Convert display colour in the host, not the engine.'
      );
    }
    if (!Array.isArray(color.channels) || color.channels.length !== 3) {
      throw this._strokeError('FluidEngine: color.channels must be three pigment coordinates.');
    }
    color.channels.forEach(
      (c, i) => this._validateNumber(c, `color.channels[${i}]`, { min: 0, max: 1 })
    );
    this._validateNumber(color.alpha, 'color.alpha', { min: 0, max: 1 });

    // Snapshot the rectangle's numbers: a host that mutates its own Rectangle
    // mid-stroke must not change the second half of a stroke's geometry.
    const rectangle = paintingRectangle.clone
      ? paintingRectangle.clone()
      : {
          left: paintingRectangle.left,
          bottom: paintingRectangle.bottom,
          width: paintingRectangle.width,
          height: paintingRectangle.height,
        };

    const alpha = color.alpha;
    this._stroke = {
      timing,
      brushSize,
      rectangle,
      resolutionScale,
      color: [color.channels[0], color.channels[1], color.channels[2], alpha],
      /* Spacing must be expressed in the SAME space as x/y. It defaults to a
       * fraction of brushSize, which is right whenever the two share a space.
       * A host whose coordinates are device pixels while brushSize is a CSS
       * measure (the main app at devicePixelRatio > 1) must pass its own, or
       * the same gesture emits a different number of samples per device --
       * measured as +247% deposited alpha at dpr2 before this existed. */
      spacing: spacing !== undefined
        ? spacing
        : Math.max(STROKE_MIN_SPACING, STROKE_SPACING_FRACTION * brushSize),
      zThreshold: STROKE_Z_THRESHOLD * brushSize,
      splatRadius: STROKE_SPLAT_RADIUS * brushSize,
      velocityScale: STROKE_VELOCITY_SCALE * alpha * resolutionScale,
      // The last point actually pushed into the simulation, and the last point
      // the caller gave us. They differ whenever a segment was shorter than the
      // remaining spacing; endStroke() flushes the difference.
      emitted: { x, y, pressure },
      pending: { x, y, pressure },
      remainder: 0,
    };

    /* Select the footprint before either initialize() below: initialize() is
     * what draws the bristles, so the shape must already be in place. It
     * persists on the brush until the next beginStroke, which is why a stroke
     * without brushShape explicitly restores the round default rather than
     * inheriting the previous press's shape. */
    if (typeof this.brush.setBristleShape === 'function') {
      this.brush.setBristleShape(brushShape);
    } else if (brushShape) {
      // A brush without footprint support would silently paint round, which is
      // worse than saying so: the caller asked for a shape it will not get.
      throw this._strokeError('FluidEngine: this brush does not support brushShape.');
    }

    if (timing === 'live') {
      try {
        this.brush.initialize(x, y, this._strokeHeight(pressure), brushSize, true);
        this._liveTarget = { x, y, height: this._strokeHeight(pressure), scale: brushSize };
        this._previousLiveTarget = this._liveTarget;
        // A sub-tick tap makes one contact, without settling or fluid time.
        this._liveContact(true);
      } catch (error) {
        this._stroke = null;
        throw error;
      }
      return { steps: 0, simulationUpdated: true };
    }
    this._liveTarget = undefined;
    this._previousLiveTarget = undefined;

    let steps = 0;
    let simulationUpdated = false;
    try {
      // Private, not this.initializeBrush(): the public primitive is guarded
      // against reentry and _stroke is already set. This also draws the Phase
      // 8a variation -- exactly one per press.
      this.brush.initialize(x, y, this._strokeHeight(pressure), brushSize);
      for (let i = 0; i < STROKE_SETTLE_STEPS; ++i) {
        if (this._strokeSample(x, y, pressure)) simulationUpdated = true;
        steps++;
      }
    } catch (e) {
      // A GPU failure mid-begin must not strand the machine active; the partial
      // deposit cannot be rolled back, but the caller can start a new stroke.
      this._stroke = null;
      throw e;
    }
    return { steps, simulationUpdated };
  }

  /**
   * Extend a stroke. Live mode only replaces the latest target (O(1)).
   * Replay mode arc-length resamples synchronously at fixed spacing.
   *
   * The unused distance carries across calls, so splitting one straight segment
   * into twenty caller points emits exactly the same samples as passing its
   * endpoint once. That is what makes output independent of input timing and
   * event coalescing.
   */
  strokeTo({ x, y, pressure }) {
    if (!this.strokeActive) {
      throw this._strokeError('FluidEngine: strokeTo() called with no active stroke.');
    }
    const stroke = this._stroke;
    this._validateNumber(x, 'x');
    this._validateNumber(y, 'y');
    if (pressure === undefined) pressure = stroke.pending.pressure;
    this._validateNumber(pressure, 'pressure', { min: 0, max: 1 });

    if (stroke.timing === 'live') {
      stroke.pending = { x, y, pressure };
      this._liveTarget = { x, y, height: this._strokeHeight(pressure), scale: stroke.brushSize };
      return { steps: 0, simulationUpdated: false };
    }

    const from = stroke.pending;
    const dx = x - from.x;
    const dy = y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    let steps = 0;
    let simulationUpdated = false;

    if (length > 0) {
      let travelled = stroke.spacing - stroke.remainder;
      while (travelled <= length) {
        const t = travelled / length;
        const sx = from.x + dx * t;
        const sy = from.y + dy * t;
        // Pressure follows arc position, so a pressure ramp does not depend on
        // how the caller happened to chop the path up.
        const sp = from.pressure + (pressure - from.pressure) * t;
        try {
          if (this._strokeSample(sx, sy, sp)) simulationUpdated = true;
        } catch (e) {
          this._stroke = null;
          throw e;
        }
        stroke.emitted = { x: sx, y: sy, pressure: sp };
        steps++;
        travelled += stroke.spacing;
      }
      stroke.remainder = length - (travelled - stroke.spacing);
    }

    // Always remember where the caller actually is, even when nothing was
    // emitted -- endStroke() needs it to reach the path's true endpoint.
    stroke.pending = { x, y, pressure };
    return { steps, simulationUpdated };
  }

  /**
   * Lift. Flushes the final caller point if the stroke has not reached it yet,
   * then clears state. It adds no arbitrary settle frames: this bounds live lag
   * below one spacing interval without letting segmentation affect dynamics.
   */
  endStroke() {
    if (!this.strokeActive) {
      throw this._strokeError('FluidEngine: endStroke() called with no active stroke.');
    }
    const stroke = this._stroke;
    const pending = stroke.pending;
    const emitted = stroke.emitted;

    if (stroke.timing === 'live') {
      const changed = pending.x !== emitted.x || pending.y !== emitted.y || pending.pressure !== emitted.pressure;
      // Preserve the final endpoint even if pointerup precedes the next RAF.
      // A swept final contact does not integrate either physical system.
      if (changed) this._liveContact(true);
      this._stroke = null;
      return { steps: 0, simulationUpdated: changed };
    }

    let steps = 0;
    let simulationUpdated = false;
    try {
      if (
        pending.x !== emitted.x ||
        pending.y !== emitted.y ||
        pending.pressure !== emitted.pressure
      ) {
        if (this._strokeSample(pending.x, pending.y, pending.pressure)) simulationUpdated = true;
        steps++;
      }
    } finally {
      this._stroke = null;
    }
    return { steps, simulationUpdated };
  }

  /** Brush height for a pressure, with the floor that keeps a light touch painting. */
  _strokeHeight(pressure) {
    return STROKE_HEIGHT_SCALE * this._stroke.brushSize * Math.max(pressure, STROKE_MIN_PRESSURE);
  }

  /*
   * One internal sample: position, splat, frame -- in that order.
   *
   * Do not swap splat and frame. The application has always deposited into the
   * pre-step fluid state, and swapping them puts the paint into a different
   * one. These call the private brush/simulator directly so the public guard
   * does not reject the API's own samples.
   */
  _strokeSample(x, y, pressure) {
    const stroke = this._stroke;
    this.brush.update(x, y, this._strokeHeight(pressure), stroke.brushSize);
    this.simulator.splat(
      this.brush,
      stroke.zThreshold,
      stroke.rectangle,
      stroke.color,
      stroke.splatRadius,
      stroke.velocityScale
    );
    return this.simulator.simulate();
  }

  /**
   * Interactive clock. One brush/splat/fluid step per 1/60 second, at most
   * five per call. Input is a latest-position mailbox, not a work queue.
   * The existing splat shader sweeps between bristle positions each tick.
   * Replay methods retain their legacy spatial semantics unless timing:'live'.
   */
  advance(now, target) {
    this._validateNumber(now, 'now', { min: 0 });
    if (this.strokeActive && this._stroke.timing !== 'live') {
      throw this._strokeError('advance() cannot run a legacy replay stroke.');
    }
    if (target && !this.strokeActive) this._liveTarget = { ...target };
    const current = this._liveTarget;
    if (this._lastAdvance === undefined) this.resetClock(now);
    if (now < this._lastAdvance) throw this._strokeError('Clock must be monotonic.');
    const elapsed = now - this._lastAdvance;
    const previousTime = this._lastAdvance;
    this._lastAdvance = now;
    const dt = 1 / 60;
    this._accumulator += elapsed;
    const due = Math.floor((this._accumulator + 1e-10) / dt);
    const steps = Math.min(due, 5);
    const droppedSeconds = (due - steps) * dt;
    // Drop the oldest excess ticks, then consume the latest interval. There
    // is no unfinished stamp batch that can hold simulation time hostage.
    this._accumulator = Math.max(0, this._accumulator - due * dt);
    const previous = this._previousLiveTarget || current;
    let simulationUpdated = false;
    for (let i = 0; i < steps; i++) {
      if (current) {
        const tickTime = now - this._accumulator - (steps - 1 - i) * dt;
        const t = droppedSeconds > 0 || elapsed === 0 ? 1
          : Math.max(0, Math.min(1, (tickTime - previousTime) / elapsed));
        this.brush.update(
          previous.x + (current.x - previous.x) * t,
          previous.y + (current.y - previous.y) * t,
          previous.height + (current.height - previous.height) * t,
          current.scale
        );
        if (this.strokeActive) this._liveContact(false);
      }
      if (this.simulator.simulate()) simulationUpdated = true;
    }
    this._previousLiveTarget = current;
    this._simulatedSeconds = (this._simulatedSeconds || 0) + steps * dt;
    this._droppedSeconds = (this._droppedSeconds || 0) + droppedSeconds;
    this.timingStats = {
      steps, stamps: this.strokeActive ? steps : 0, droppedSeconds,
      simulatedSeconds: this._simulatedSeconds, totalDroppedSeconds: this._droppedSeconds,
      accumulator: this._accumulator, simulationUpdated,
    };
    return this.timingStats;
  }

  /** Forget suspended wall time without transforming event timestamps. */
  resetClock(now) {
    this._lastAdvance = now;
    this._accumulator = 0;
    this._previousLiveTarget = this._liveTarget;
  }

  _liveContact(stationary) {
    const s = this._stroke;
    const p = stationary ? s.pending : {
      x: this.brush.positionX, y: this.brush.positionY,
      pressure: this.brush.positionZ / (STROKE_HEIGHT_SCALE * s.brushSize),
    };
    this.simulator.splat(this.brush, s.zThreshold, s.rectangle, s.color,
      s.splatRadius, stationary ? 0 : s.velocityScale,
      stationary ? [p.x - this.brush.positionX, p.y - this.brush.positionY,
        this._strokeHeight(p.pressure) - this.brush.positionZ] : [0, 0, 0], stationary);
    s.emitted = { ...p };
  }

  // --- Painting geometry ------------------------------------------------

  /** Re-allocate at a new simulation resolution, discarding nothing. */
  changeResolution(width, height) {
    this._assertNoStroke('changeResolution()');
    this.simulator.changeResolution(width, height);
  }

  /**
   * Resize the painting, feathering its edge.
   *
   * The feather width is the engine's, not the host's: it must match the width
   * painting.frag's preview uses or the painting visibly jumps when the user
   * releases the resize handle. The host does not get to choose it.
   */
  resizePainting(width, height, offsetX, offsetY) {
    this._assertNoStroke('resizePainting()');
    this.simulator.resize(
      width,
      height,
      offsetX,
      offsetY,
      PaintingRenderer.RESIZING_FEATHER_SIZE
    );
  }

  /** Discard all paint. Velocity is not cleared; a following frame settles it. */
  clear() {
    this._assertNoStroke('clear()');
    this.simulator.clear();
  }

  // --- Snapshots --------------------------------------------------------
  //
  // The engine produces and reloads snapshots; it keeps no history stack.
  // How many to hold, when to take one, and what undo means are the host's.

  /**
   * Allocate a snapshot handle sized for the current simulation.
   *
   * The engine allocates it because the texture must match the simulation's
   * paint texture type, which is chosen at construction by capability probe and
   * is half-float on devices that cannot blend into full float. A host that
   * allocated its own gl.FLOAT texture would work everywhere except exactly the
   * devices the probe exists for, and would fail there at undo rather than at
   * startup.
   */
  createSnapshot(paintingWidth, paintingHeight, resolutionScale) {
    const wgl = this.wgl;
    const texture = wgl.buildTexture(
      wgl.RGBA,
      this.simulator.paintTextureType,
      this.simulator.resolutionWidth,
      this.simulator.resolutionHeight,
      null,
      wgl.CLAMP_TO_EDGE,
      wgl.CLAMP_TO_EDGE,
      wgl.NEAREST,
      wgl.NEAREST
    );

    // A fresh snapshot is transparent, not whatever was last in this memory.
    const framebuffer = wgl.createFramebuffer();
    wgl.framebufferTexture2D(
      framebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      texture,
      0
    );
    wgl.clear(wgl.createClearState().bindFramebuffer(framebuffer), wgl.COLOR_BUFFER_BIT);
    wgl.deleteFramebuffer(framebuffer);

    return new PaintSnapshot(texture, paintingWidth, paintingHeight, resolutionScale);
  }

  /**
   * Copy the current paint into a snapshot handle, re-allocating its texture if
   * the simulation resolution has changed since the handle was made.
   */
  saveSnapshot(snapshot, paintingWidth, paintingHeight, resolutionScale) {
    const wgl = this.wgl;

    if (
      snapshot.getTextureWidth() !== this.simulator.resolutionWidth ||
      snapshot.getTextureHeight() !== this.simulator.resolutionHeight
    ) {
      wgl.rebuildTexture(
        snapshot.texture,
        wgl.RGBA,
        this.simulator.paintTextureType,
        this.simulator.resolutionWidth,
        this.simulator.resolutionHeight,
        null,
        wgl.CLAMP_TO_EDGE,
        wgl.CLAMP_TO_EDGE,
        wgl.NEAREST,
        wgl.NEAREST
      );
    }

    this.simulator.copyPaintTexture(snapshot.texture);

    snapshot.paintingWidth = paintingWidth;
    snapshot.paintingHeight = paintingHeight;
    snapshot.resolutionScale = resolutionScale;
  }

  /**
   * Reload a snapshot's paint, changing the simulation resolution first if the
   * snapshot was taken at a different one.
   *
   * The host is responsible for restoring its own painting rectangle and
   * quality setting from the snapshot's readable fields -- the engine cannot,
   * because it does not own them.
   */
  restoreSnapshot(snapshot, resolutionWidth, resolutionHeight) {
    this._assertNoStroke('restoreSnapshot()');
    if (
      this.simulator.resolutionWidth !== resolutionWidth ||
      this.simulator.resolutionHeight !== resolutionHeight
    ) {
      this.simulator.changeResolution(resolutionWidth, resolutionHeight);
    }

    this.simulator.applyPaintTexture(snapshot.texture);
  }

  // --- Rendering --------------------------------------------------------

  /** Render the painting into a host-owned texture. See PaintingRenderer. */
  renderToTexture(options) {
    this.renderer.renderToTexture(Object.assign({ simulator: this.simulator }, options));
  }

  /** Blit an already-rendered painting texture to the screen. */
  present(texture, targetWidth, targetHeight) {
    this.renderer.present(texture, targetWidth, targetHeight);
  }

  /** Set or clear the dry image layer rendered beneath wet paint. */
  setBackgroundImage(source) {
    this._assertNoStroke('setBackgroundImage()');
    this.renderer.setBackgroundImage(source);
  }

  clearBackgroundImage() {
    this._assertNoStroke('clearBackgroundImage()');
    this.renderer.clearBackgroundImage();
  }

  /**
   * Replace the dry image layer with an already-rendered painting and start a
   * new, empty wet-paint stage. The host owns history invalidation.
   */
  bakeToBackground(source) {
    this._assertNoStroke('bakeToBackground()');
    this.renderer.setBackgroundImage(source);
    this.simulator.clearPaintAndDynamics();
    this.resetClock();
  }

  /** Render the painting at full resolution and read it back as RGBA bytes. */
  exportPixels(options) {
    return this.renderer.renderToPixels(Object.assign({ simulator: this.simulator }, options));
  }

  /**
   * Read the raw paint texture back as floats.
   *
   * This is the simulation's own state -- RYB pigment, pre-lighting -- not what
   * the eye sees, so it is independent of canvas size and every piece of chrome
   * drawn over the painting. That is exactly what makes it the right thing for a
   * regression harness to hash, and why the engine exposes it rather than
   * leaving a test to reach for `simulator.paintTexture`.
   *
   * Note it reads with gl.FLOAT even when the paint texture is half-float. That
   * combination is accepted by every driver tested so far, WebKit's included.
   *
   * @returns {{width: number, height: number, pixels: Float32Array}}
   */
  readPaintTexture() {
    const wgl = this.wgl;
    const width = this.simulator.resolutionWidth;
    const height = this.simulator.resolutionHeight;

    const framebuffer = wgl.createFramebuffer();
    wgl.framebufferTexture2D(
      framebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      this.simulator.paintTexture,
      0
    );

    const pixels = new Float32Array(width * height * 4);
    wgl.readPixels(
      wgl.createReadState().bindFramebuffer(framebuffer),
      0,
      0,
      width,
      height,
      wgl.RGBA,
      wgl.FLOAT,
      pixels
    );

    wgl.deleteFramebuffer(framebuffer);
    return { width, height, pixels };
  }

  /**
   * The GL objects the bristle preview needs to draw itself.
   *
   * This is chrome reaching into the engine, and it is deliberately one named
   * method rather than four public fields. The preview is a debug overlay the
   * host draws with its own program and projection, so the engine cannot draw
   * it -- but nothing else should be reaching for these, and a single named
   * seam makes a second caller obvious in review.
   */
  getBristleGeometry() {
    const target = this._liveTarget;
    return {
      displayOffset: target ? [target.x - this.brush.positionX,
        target.y - this.brush.positionY, target.height - this.brush.positionZ] : [0, 0, 0],
      positionsTexture: this.brush.positionsTexture,
      coordinatesBuffer: this.brush.brushTextureCoordinatesBuffer,
      indexBuffer: this.brush.brushIndexBuffer,
      indexCount: this.brush.indexCount,
      bristleCount: this.brush.bristleCount,
      maxBristleCount: this.brush.maxBristleCount,
    };
  }

  /**
   * Bytes of render-target memory a painting of this size would need, at this
   * scale, including `historyDepth` host-held snapshots.
   *
   * Static, because the host has to ask this *before* the engine exists: the
   * answer is what decides the resolution the engine is then constructed at.
   * An instance method would be unreachable at exactly the moment it is needed.
   *
   * The engine answers it at all because only it knows the target count.
   * Computed, never remembered -- the first attempt at this arithmetic was
   * wrong by 4x, having used 4 bytes a texel instead of 16 and ignored the
   * snapshots entirely.
   */
  static estimateRenderTargetBytes(paintingWidth, paintingHeight, resolutionScale, historyDepth) {
    const area = paintingWidth * paintingHeight * resolutionScale * resolutionScale;
    return area * BYTES_PER_RGBA_TEXEL * (SIMULATION_RENDER_TARGETS + historyDepth);
  }

  /**
   * The largest resolution scale whose render targets fit in `budgetBytes`.
   *
   * The inverse of estimateRenderTargetBytes: bytes scale with the square of
   * the scale, so the scale that exactly spends the budget is a square root.
   */
  static maxResolutionScaleForBudget(paintingWidth, paintingHeight, historyDepth, budgetBytes) {
    const area = paintingWidth * paintingHeight;
    if (area <= 0) return Infinity;
    const perUnitScale =
      area * BYTES_PER_RGBA_TEXEL * (SIMULATION_RENDER_TARGETS + historyDepth);
    return Math.sqrt(budgetBytes / perUnitScale);
  }
}

/*
 * The two things a host must know BEFORE it can construct an engine, published
 * on the class for the same reason the budget arithmetic is static: the host
 * needs them at a moment when no instance exists.
 *
 * SHADER_FILES is what to load; COLOR_MODEL is what to pass to renderToTexture.
 * Both were app-owned until Phase 9 built a second host and found that hosting
 * the engine required copying pieces of the first host. See examples/minimal/.
 */
FluidEngine.SHADER_FILES = ENGINE_SHADER_FILES;
FluidEngine.COLOR_MODEL = COLOR_MODEL;

/*
 * COLOR_MODEL.RGB is the name; renderer.js's private ColorModelRGB is the value
 * actually compared against. They are two declarations of one number, because
 * there is no module system here and renderer.js loads first -- so this checks
 * at startup that they still agree.
 *
 * It throws rather than warns. A disagreement means every host passing
 * COLOR_MODEL.RGB silently gets the RYB path instead, since the renderer's test
 * is an equality and everything that fails it falls through to RYB. That is a
 * wrong picture with no error, which is the failure mode this whole phase kept
 * running into. Better to fail at load, loudly, in the one place that can tell.
 */
if (typeof ColorModelRGB !== 'undefined' && ColorModelRGB !== COLOR_MODEL.RGB) {
  throw new Error(
    `FluidEngine.COLOR_MODEL.RGB (${COLOR_MODEL.RGB}) disagrees with ` +
    `renderer.js's ColorModelRGB (${ColorModelRGB}); the renderer would ` +
    'silently composite in RYB. Make them equal.'
  );
}
