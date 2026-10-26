// Tilecraft story-model adapter for FluidEngine's public Stroke API.
//
// This is deliberately outside FluidEngine: Tilecraft's JSON, #RRGGBB colours,
// layer rules and canvas-coordinate transform belong to the importing host, not
// to the fluid simulation.  The adapter never reads engine.brush/simulator.

const TILECRAFT_BRUSH_SIZE_CORRECTION_RATE = 1;
// Widest-to-narrowest `s` a single immutable stroke may cover before the run
// is split. 2x cuts the onset ramp -- where the over-width lives -- while
// leaving ordinary pressure variation, and a 1->2 `s` step, in one stroke.
const WIDTH_SPLIT_RATIO = 2;
const PLAYBACK_DURATION_EXPONENT = Math.log(10) / Math.log(800);

/*
 * Paint load for a single stamp, in contacts.
 *
 * A stamp is ONE splat: beginStroke() deposits at the contact point and
 * endStroke() adds nothing, because nothing moved. A path of the same width
 * gets one splat per spacing interval, so a path's marks overlap while a
 * stamp's never do.
 *
 * What a stamp is missing is COVERAGE, not alpha. Each bristle splats a small
 * disc, so one press can leave gaps; a path hides them by overlapping many
 * presses.
 *
 * Repeated contacts close those gaps. Imported spots now draw a fresh
 * equal-area bristle layout on every press; their centres stay fixed unless
 * TILECRAFT_SPOT_SCATTER is explicitly enabled.
 *
 * Eight contacts retain the established paint load. The old coverage numbers
 * used the jittered sunflower layout and must be remeasured after the new
 * per-contact randomization.
 *
 * It stays a count of contacts rather than an alpha multiplier so that a
 * semi-transparent layer stays visibly semi-transparent, which acceptance
 * criterion 5 requires: each contact deposits the layer's own alpha, so
 * `opacity: 125` still composites to roughly half of `opacity: 255`. Hosts
 * override it per run.
 */
const TILECRAFT_SPOT_PAINT_LOAD = 8;
// An analytic path deposits once per covered pixel. At the normal 0.04 brush
// alpha, sixteen equivalent contacts give 1-(1-0.04)^16 = 0.48 centre opacity:
// solid enough for light source colours, with alpha still responsive to the
// user's brush setting. Width stays independent of paint load.
const TILECRAFT_PATH_PAINT_LOAD = 16;

/*
 * How far a stamp's repeated contacts scatter, as a fraction of its radius.
 *
 * DEFAULT 0 -- deliberately off, and measured rather than assumed.
 *
 * Each spot contact gets a fresh bristle layout, so shifting the entire
 * contact is not needed to vary the mark. The measurements below describe
 * the earlier jittered sunflower layout and should be recalibrated for the
 * new per-contact distribution.
 *
 * Positional scatter enlarges and softens a stamp; leave it opt-in for cases
 * where that effect is wanted.
 *
 * It is kept as a tunable, not deleted, because a host painting very large
 * stamps at a low bristle count may still want it; but it must be opted into
 * with a number, and its cost in spill is the thing to watch.
 */
const TILECRAFT_SPOT_SCATTER = 0;

/*
 * A Tilecraft layer shape carries two independent facts:
 *
 *   TOPOLOGY -- are the tiles a connected path, or independent spots?
 *   FOOTPRINT -- what shape does each individual mark have?
 *
 * Only `polyline` is a path. In render.js, `square`, `circle`, `polygon` and
 * `slash` are all drawn from inside the per-tile loop -- `square` by its own
 * `fillRect` -- while `connectPoints()` is reached only under
 * `if (tileShape === 'polyline')`.
 *
 * `square` was classified as a path here once, on the grounds that its tiles
 * carry `g`/`b` and that their spacing matches a polyline layer at the same
 * gridSize (median 6.8 vs 7.1 in the observed exports). That measurement does
 * not establish topology: `getGroupedRanges()` in render-core.js builds groups
 * for EVERY layer regardless of tileShape, so `g`, `b` and `gd` are the
 * carriers of the group scale and say nothing about connectedness, and tile
 * spacing is set by the input device rather than by the renderer. The tap count
 * that argument cited (46,899 for ~2,200 strokes) is a consequence of the
 * correct classification, not evidence against it -- if it costs too much, that
 * is a playback-performance question, not a geometry one.
 */
const TILECRAFT_PATH_SHAPES = new Set(['polyline']);
const TILECRAFT_SPOT_SHAPES = new Set(['polygon', 'circle', 'slash', 'square', 'rectangle']);

/*
 * Bristle footprints, in the units FluidEngine's Brush accepts:
 * `sides` < 3 means the round default, and `aspect` is width/height.
 *
 * Tilecraft's polygonSize is the number of vertices. The angle and optional
 * per-tile sa are transformed from its downward-Y canvas into Fluid's upward-Y
 * coordinates at the call site.
 *
 * `slash` is the source renderer's thin diagonal bar (render.js
 * drawSlashRect): a 4-gon squashed to a 5:1 strip and rotated 45 degrees so
 * it reads as a stroke rather than a diamond.
 *
 * `square` carries NO rotation: render.js draws it with `ctx.fillRect`, which
 * is axis-aligned. A 45-degree turn here would paint a diamond, which is a
 * different mark from the reference even though the UI sometimes names it one.
 */
const TILECRAFT_BRUSH_SHAPES = {
  polyline: null,
  polygon: null,
  circle: null,
  square: { sides: 4, aspect: 1, rotation: 0 },
  rectangle: { sides: 4, aspect: 1, rotation: 0 },
  slash: { sides: 4, aspect: 5, rotation: Math.PI / 4 },
};

function targetPlaySeconds(operationCount) {
  if (!Number.isFinite(operationCount) || operationCount <= 0) return 0;
  return Math.min(50, Math.max(5 / 3,
    5 * Math.pow(operationCount / 50, PLAYBACK_DURATION_EXPONENT)));
}

function operationVisualWeight(operation, previous) {
  let weight = 1;
  if (operation?.segmentStart) weight += 2;
  if (!previous || operation?.frameKey !== previous.frameKey) weight += 6;
  return weight;
}

class TilecraftStrokePlayer {
  static targetPlaySeconds(operationCount) { return targetPlaySeconds(operationCount); }

  static operationVisualWeight(operation, previous) {
    return operationVisualWeight(operation, previous);
  }

  /** Does this Tilecraft layer shape paint as independent spots? */
  static isSpotShape(tileShape) { return TILECRAFT_SPOT_SHAPES.has(tileShape); }

  /** Does this Tilecraft layer shape paint as a connected path? */
  static isPathShape(tileShape) { return TILECRAFT_PATH_SHAPES.has(tileShape); }

  /**
   * The bristle footprint a layer shape paints with, or null for the round
   * default. Returned fresh so a frozen plan operation cannot be aliased into
   * the shared table.
   *
   * `layer.mod === 1` mirrors the footprint vertically (source render.js's
   * `backSlash` flip on `drawSlashRect`: 0 draws "/", 1 draws "\\" -- the same
   * rectangle reflected across the vertical axis, not rotated a further 180
   * degrees). Negating `rotation` is exactly that reflection in
   * setbristles.frag's convention, where a positive rotation turns the
   * footprint counter-clockwise from its unrotated vertex-at-3-o'clock pose.
   */
  static brushShape(tileShape, layer, tile = null, alternate = false) {
    if (tileShape === 'polygon') {
      const sides = layer?.polygonSize;
      if (!Number.isInteger(sides) || sides < 3 || sides > 8) return null;
      let angle = sides % 2 ? -Math.PI / 2 : sides > 4 ? -Math.PI / sides : 0;
      if (layer.mod > 0 && !alternate) angle += sides % 2 ? Math.PI : Math.PI / sides;
      if (Number.isFinite(tile?.sa)) angle += tile.sa;
      return { sides, rotation: -angle };
    }
    const shape = TILECRAFT_BRUSH_SHAPES[tileShape];
    if (!shape) return null;
    const mirrored = layer && layer.mod === 1 && shape.rotation !== undefined
      ? { ...shape, rotation: -shape.rotation }
      : { ...shape };
    return mirrored;
  }
  /**
   * Validate a transferred Tilecraft model before a scene is allowed to
   * replace the active Fluid canvas. Execution-plan compilation still belongs
   * to an instance, because it requires this canvas's FluidEngine.
   */
  static compile(model) {
    if (typeof compileFluidStoryModel !== 'function') {
      throw new Error('Tilecraft fluid-model.js must load before TilecraftStrokePlayer.compile().');
    }
    return compileFluidStoryModel(model);
  }

  constructor(engine) {
    if (!engine || typeof engine.beginStroke !== 'function' ||
        typeof engine.strokeTo !== 'function' || typeof engine.endStroke !== 'function') {
      throw new TypeError('TilecraftStrokePlayer requires the public FluidEngine Stroke API.');
    }
    this.engine = engine;
  }

  /**
   * Replay a Tilecraft render model frame by frame. Within a frame, original
   * layer/source order determines paint stacking. A polyline group's first
   * tile defines its colour; polygon tiles are independent paint spots.
   *
   * `mapPoint(tile, layer)` is the coordinate-boundary hook. It must return
   * finite bottom-left-origin engine coordinates; the model itself stays in its
   * own canvas coordinate space. The identity mapping is useful when both
   * spaces already agree.
   */
  replay(model, options) {
    const context = this._context(model, options);
    const { stats } = context;

    for (const unit of this._playbackUnits(model, context)) {
      if (unit.kind === 'polyline') {
        this._replayPolylineSegment(unit.segment, unit.layer, context);
      } else {
        this._replayPolygonTile(unit.tile, unit.layer, context);
      }
    }
    return stats;
  }

  /**
   * Animate the same model through live strokes. A host's normal RAF loop must
   * call engine.advance(); this method deliberately only feeds its input
   * mailbox once per supplied frame. A host may opt into `ticksPerFrame` with
   * its public `advance()` clock to fast-forward a non-interactive story
   * without dropping its intermediate points. `onPaint` is where a host marks
   * its presentation dirty after a programmatic input update.
   */
  async play(model, options) {
    const context = this._context(model, options);
    const waitFrame = options.waitFrame || (() => new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
      else resolve();
    }));
    const framesPerStep = options.framesPerStep === undefined ? 1 : options.framesPerStep;
    if (!Number.isInteger(framesPerStep) || framesPerStep < 1) {
      throw new TypeError('Tilecraft live playback framesPerStep must be a positive integer.');
    }
    const ticksPerFrame = options.ticksPerFrame === undefined ? 1 : options.ticksPerFrame;
    if (!Number.isInteger(ticksPerFrame) || ticksPerFrame < 1) {
      throw new TypeError('Tilecraft live playback ticksPerFrame must be a positive integer.');
    }
    if (ticksPerFrame > 1 && framesPerStep !== 1) {
      throw new TypeError('Use either ticksPerFrame (fast) or framesPerStep (slow), not both.');
    }
    if (ticksPerFrame > 1 && typeof options.advanceTick !== 'function') {
      throw new TypeError('Fast Tilecraft playback requires options.advanceTick().');
    }
    const waitStep = async () => {
      for (let i = 0; i < framesPerStep; i++) await waitFrame();
    };
    let ticksThisFrame = 0;
    const fastTick = ticksPerFrame === 1 ? null : async () => {
      await options.advanceTick();
      ticksThisFrame++;
      if (ticksThisFrame === ticksPerFrame) {
        // The host returns the engine clock to wall time before yielding, so
        // its ordinary RAF cannot see a synthetic future timestamp.
        if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
        ticksThisFrame = 0;
        await waitFrame();
      }
    };
    const finishFastTicks = () => {
      if (fastTick && ticksThisFrame > 0 && typeof options.resetAdvanceClock === 'function') {
        options.resetAdvanceClock();
      }
    };
    const onPaint = options.onPaint || (() => {});
    const { stats } = context;

    try {
      for (const unit of this._playbackUnits(model, context)) {
        if (unit.kind === 'polyline') {
          await this._playPolylineSegment(
            unit.segment, unit.layer, context, waitStep, onPaint, fastTick
          );
          continue;
        }
        const { tile, layer } = unit;
        const point = this._map(tile, layer, context);
        if (!point) { stats.skipped++; continue; }
        if (!fastTick) await waitStep();
        const size = this._tileSize(tile, layer, context);
        const relative = tile.s === undefined ? 1 : tile.s;
        const scatter = context.spotScatter * size;
        const seed = TilecraftStrokePlayer._scatterSeed(point.x, point.y);
        this._stampContacts(
          (offset) => this._begin(point, tile, size, layer, context, relative, 'live',
            tile.c, false, offset),
          context.spotPaintLoad,
          () => { stats.spots++; onPaint(); },
          scatter, seed
        );
        if (layer.tileShape === 'polygon' && layer.mod == 2 &&
            TilecraftStrokePlayer.brushShape(layer.tileShape, layer, tile)) {
          this._stampContacts(
            (offset) => this._begin(point, tile, size, layer, context, relative, 'live',
              tile.c, true, offset),
            context.spotPaintLoad,
            () => { stats.spots++; onPaint(); },
            scatter, seed
          );
        }
        if (fastTick) await fastTick();
      }
    } finally {
      finishFastTicks();
    }
    return stats;
  }

  /**
   * Compile Tilecraft input into one immutable execution order. The UI uses
   * this plan for frame navigation; replay() and play() remain compatible
   * with older sequential callers.
   */
  compile(model, options) {
    const context = this._context(model, options);
    const operations = [];
    const visible = model.layers
      .map((layer, layerIndex) => ({ layer, layerIndex }))
      .filter(({ layer }) => layer && layer.visible);

    for (const { layer, layerIndex } of visible) {
      if (TilecraftStrokePlayer.isPathShape(layer.tileShape)) {
      context.stats.layers++;
      let segmentOrdinal = 0;
      for (const segment of this._polylineSegments(layer, context.stats, context)) {
        const { tiles, closes, groupScale } = segment;
        const sizes = tiles.map((tile) => this._useAnalyticPath(context)
          ? 2 * this._pathRadius(tile, layer, context)
          : this._tileSize(tile, layer, context, groupScale));
        const brushSize = Math.max(...sizes);
        const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
        const firstTile = tiles[0];
        const frameKey = this._frameKey(firstTile && firstTile.f);
        const rawGroup = firstTile && firstTile.g !== undefined
          ? String(firstTile.g)
          : `ungrouped-${segmentOrdinal}`;
        const segmentKey = `${layerIndex}:${frameKey}:${rawGroup}:${segmentOrdinal}`;
        const groupKey = `${layerIndex}:${frameKey}:${rawGroup}`;
        const mapped = [];
        tiles.forEach((tile, sourceTileIndex) => {
          const point = this._map(tile, layer, context);
          if (!point) { context.stats.skipped++; return; }
          mapped.push({ tile, sourceTileIndex, point });
        });
        if (!mapped.length) { segmentOrdinal++; continue; }

        const color = this._color(segment.groupColor, layer, context, firstTile);
        const pathBrushShape = TilecraftStrokePlayer.brushShape(layer.tileShape, layer);
        mapped.forEach((entry, pointIndex) => {
          operations.push({
            kind: 'polyline-point',
            layerIndex,
            layerTag: layer.tag,
            frameKey,
            frameLabel: this._frameLabel(firstTile.f),
            groupKey,
            groupLabel: firstTile.g === undefined ? `Group ${segmentOrdinal + 1}` : `Group ${firstTile.g}`,
            segmentKey,
            segmentStart: pointIndex === 0,
            segmentEnd: pointIndex === mapped.length - 1 && !closes,
            point: entry.point,
            pressure: this._pressure(entry.tile, maximumRelativeSize, context),
            brushSize,
            pathRadius: this._pathRadius(entry.tile, layer, context),
            relativeSize: entry.tile.s === undefined ? 1 : entry.tile.s,
            pathWidthUnit: this._pathRadius(entry.tile, layer, context, 1),
            analyticPath: this._useAnalyticPath(context),
            pathJoinCorrection: context.pathJoinCorrection,
            paintLoad: context.pathPaintLoad,
            brushShape: pathBrushShape,
            color,
            paintingRectangle: context.paintingRectangle,
            resolutionScale: context.resolutionScale,
            sourceTileIndex: entry.sourceTileIndex,
          });
        });
        if (closes && mapped.length > 2) {
          operations.push({
            ...operations[operations.length - mapped.length],
            segmentStart: false,
            segmentEnd: true,
            closure: true,
          });
        } else if (mapped.length) {
          operations[operations.length - 1].segmentEnd = true;
        }
        segmentOrdinal++;
      }
      } else if (TilecraftStrokePlayer.isSpotShape(layer.tileShape)) {
      context.stats.layers++;
      for (let sourceTileIndex = 0; sourceTileIndex < (layer.tiles || []).length; sourceTileIndex++) {
        const tile = layer.tiles[sourceTileIndex];
        if (!this._isDrawableTile(tile)) { context.stats.skipped++; continue; }
        const point = this._map(tile, layer, context);
        if (!point) { context.stats.skipped++; continue; }
        const frameKey = this._frameKey(tile.f);
        const rawGroup = tile.g === undefined ? `spot-${sourceTileIndex}` : String(tile.g);
        const groupKey = `${layerIndex}:${frameKey}:${rawGroup}`;
        operations.push({
          kind: 'polygon-spot',
          layerIndex,
          layerTag: layer.tag,
          frameKey,
          frameLabel: this._frameLabel(tile.f),
          groupKey,
          groupLabel: tile.g === undefined ? `Spot ${sourceTileIndex + 1}` : `Group ${tile.g}`,
          point,
          pressure: this._pressure(tile, tile.s === undefined ? 1 : tile.s, context),
          brushSize: this._tileSize(tile, layer, context),
          brushShape: TilecraftStrokePlayer.brushShape(layer.tileShape, layer, tile),
          // Contacts this stamp deposits, and how far they scatter as a
          // fraction of its radius. Frozen into the plan so a resumed or
          // re-navigated run cannot paint it with a different coverage.
          paintLoad: context.spotPaintLoad,
          scatter: context.spotScatter,
          randomizeBristles: context.spotBristleVariation,
          color: this._color(tile.c, layer, context, tile),
          paintingRectangle: context.paintingRectangle,
          resolutionScale: context.resolutionScale,
          sourceTileIndex,
        });
        if (layer.tileShape === 'polygon' && layer.mod == 2 &&
            Number.isInteger(layer.polygonSize) && layer.polygonSize >= 3 && layer.polygonSize <= 8) {
          operations.push({
            ...operations[operations.length - 1],
            brushShape: TilecraftStrokePlayer.brushShape(layer.tileShape, layer, tile, true),
          });
        }
      }
      }
    }

    const frameOrderedOperations = this._groupByFrame(
      operations,
      (operation) => operation.frameKey
    );
    frameOrderedOperations.forEach((operation, index) => {
      operation.index = index;
      Object.freeze(operation);
    });
    const plan = {
      operations: Object.freeze(frameOrderedOperations),
      groupRanges: Object.freeze(this._boundaryRanges(frameOrderedOperations, 'groupKey', 'groupLabel')),
      frameRanges: Object.freeze(this._boundaryRanges(frameOrderedOperations, 'frameKey', 'frameLabel')),
      skipped: context.stats.skipped,
      layers: context.stats.layers,
      // Diagnostics for the one-pixel radius floor: how many tiles it rewrote,
      // and the smallest radius that was actually asked for.
      minimumRadiusClamped: context.stats.minimumRadiusClamped,
      smallestRequestedRadius: context.stats.smallestRequestedRadius,
    };
    return Object.freeze(plan);
  }

  /**
   * Play an immutable plan from one operation index. Painted indices reported
   * by a registry are skipped, which is the no-double-deposit guarantee used
   * by backward frame navigation.
   */
  async playPlan(plan, options = {}) {
    if (!plan || !Array.isArray(plan.operations)) {
      throw new TypeError('Tilecraft playPlan() requires a compiled playback plan.');
    }
    const startIndex = options.startIndex === undefined ? 0 : options.startIndex;
    const stopAt = options.shouldStopAt === undefined ? plan.operations.length : options.shouldStopAt;
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > plan.operations.length ||
        !Number.isInteger(stopAt) || stopAt < startIndex || stopAt > plan.operations.length) {
      throw new RangeError('Tilecraft playPlan() received an invalid operation range.');
    }

    const framesPerStep = options.framesPerStep === undefined ? 1 : options.framesPerStep;
    const ticksPerFrame = options.ticksPerFrame === undefined ? 1 : options.ticksPerFrame;
    const brushSizeMultiplier = options.brushSizeMultiplier === undefined ? 1 : options.brushSizeMultiplier;
    const targetDuration = options.targetDuration;
    const timelineEnabled = Number.isFinite(targetDuration) && targetDuration >= 0;
    if (!Number.isInteger(framesPerStep) || framesPerStep < 1 ||
        !Number.isInteger(ticksPerFrame) || ticksPerFrame < 1 ||
        (ticksPerFrame > 1 && framesPerStep !== 1)) {
      throw new TypeError('Use positive integer framesPerStep or ticksPerFrame, not both.');
    }
    if (!Number.isFinite(brushSizeMultiplier) || brushSizeMultiplier <= 0) {
      throw new TypeError('Tilecraft brushSizeMultiplier must be a positive finite number.');
    }
    if (ticksPerFrame > 1 && typeof options.advanceTick !== 'function') {
      throw new TypeError('Fast Tilecraft playback requires options.advanceTick().');
    }

    const registry = options.registry;
    const waitFrame = options.waitFrame || (() => new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(resolve);
      else resolve();
    }));
    const onPaint = options.onPaint || (() => {});
    const onProgress = options.onProgress || (() => {});
    const stats = { layers: plan.layers, strokes: 0, spots: 0, points: 0, skipped: plan.skipped };
    let activeSegment = null;
    let pendingIndex = null;
    let previousIndex = null;
    let nextIndex = startIndex;
    let ticksThisFrame = 0;
    let pendingProgress = null;
    let operationsSinceFrame = 0;
    const now = options.now || (() => performance.now());
    const timelineStart = now();
    let pausedMilliseconds = 0;
    const weights = timelineEnabled
      ? plan.operations.slice(startIndex, stopAt).map((operation, offset) =>
        operationVisualWeight(operation, plan.operations[startIndex + offset - 1]))
      : [];
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let completedWeight = 0;

    const checkAbort = () => {
      if (options.signal && options.signal.aborted) throw this._abortError();
    };
    const waitUntilReady = async () => {
      checkAbort();
      if (typeof options.waitUntilResumed === 'function') {
        const before = now();
        const didPause = await options.waitUntilResumed(options.signal);
        if (didPause) pausedMilliseconds += Math.max(0, now() - before);
      }
      checkAbort();
    };
    const flushProgress = () => {
      if (!pendingProgress) return;
      onProgress(pendingProgress);
      pendingProgress = null;
    };
    const waitTimeline = async (index) => {
      if (!timelineEnabled) return;
      const deadline = targetDuration * 1000 * completedWeight / totalWeight;
      while (now() - timelineStart - pausedMilliseconds < deadline || operationsSinceFrame >= 32) {
        await waitUntilReady();
        flushProgress();
        if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
        await waitFrame();
        operationsSinceFrame = 0;
        checkAbort();
      }
      completedWeight += weights[index - startIndex] || 0;
      operationsSinceFrame++;
      stats.maxCatchUpBatch = Math.max(stats.maxCatchUpBatch || 0, operationsSinceFrame);
    };
    const waitStep = async () => {
      if (timelineEnabled) {
        if (typeof options.advanceTick === 'function') {
          await options.advanceTick();
          if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
        }
        return;
      }
      for (let i = 0; i < framesPerStep; i++) {
        await waitUntilReady();
        await waitFrame();
        checkAbort();
      }
    };
    const markPainted = (index, operation) => {
      if (registry && typeof registry.markPainted === 'function') registry.markPainted(index, index + 1);
      stats.points++;
      if (operation.kind === 'polygon-spot') stats.spots++;
      const value = this._planProgress(plan, registry, index + 1, operation, stats);
      if (timelineEnabled) {
        value.timelineElapsed = Math.max(0, (now() - timelineStart - pausedMilliseconds) / 1000);
        value.timelineTarget = targetDuration;
      }
      if (timelineEnabled) pendingProgress = value;
      else onProgress(value);
    };
    const advanceFast = async () => {
      await options.advanceTick();
      checkAbort();
      ticksThisFrame++;
      if (ticksThisFrame === ticksPerFrame) {
        if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
        ticksThisFrame = 0;
        await waitFrame();
        checkAbort();
      }
    };
    const closeStroke = () => {
      if (activeSegment !== null) {
        if (this.engine.strokeActive !== false) this.engine.endStroke();
        activeSegment = null;
        onPaint();
      }
    };

    try {
      for (let index = startIndex; index < stopAt; index++) {
        nextIndex = index;
        await waitUntilReady();
        await waitTimeline(index);
        const operation = plan.operations[index];
        if (registry && !registry.contains(index)) {
          if (pendingIndex !== null) {
            await waitStep();
            markPainted(pendingIndex, plan.operations[pendingIndex]);
            pendingIndex = null;
          }
          closeStroke();
          previousIndex = index;
          nextIndex = index + 1;
          continue;
        }

        if (operation.kind === 'polygon-spot') {
          if (pendingIndex !== null) {
            await waitStep();
            markPainted(pendingIndex, plan.operations[pendingIndex]);
            pendingIndex = null;
          }
          closeStroke();
          if (ticksPerFrame === 1) await waitStep();
          /* All of a stamp's contacts belong to THIS operation index: the
           * registry marks an index painted exactly once, so splitting them
           * across indices would let frame navigation repaint part of a stamp
           * and change its coverage. */
          this._stampContacts(
            (offset) => this._beginPlanOperation(operation, brushSizeMultiplier, offset),
            operation.paintLoad === undefined ? 1 : operation.paintLoad,
            () => { stats.strokes++; },
            (operation.scatter === undefined ? 0 : operation.scatter) *
              operation.brushSize * brushSizeMultiplier,
            TilecraftStrokePlayer._scatterSeed(operation.point.x, operation.point.y)
          );
          markPainted(index, operation);
          onPaint();
          if (ticksPerFrame > 1) await advanceFast();
          previousIndex = index;
          nextIndex = index + 1;
          continue;
        }

        if (operation.analyticPath) {
          if (typeof this.engine.paintPathSegment !== 'function') {
            throw new Error('Tilecraft GPU path playback requires paintPathSegment().');
          }
          const previous = index > 0 ? plan.operations[index - 1] : null;
          const previousPainted = !registry || !registry.contains(index - 1);
          const connected = previous && previous.kind === 'polyline-point' &&
            previous.segmentKey === operation.segmentKey &&
            (previousIndex === index - 1 ||
              (operation.pathJoinCorrection && previousPainted));
          if (!connected) stats.strokes++;
          if (ticksPerFrame === 1) await waitStep();
          // render.js uses currentPoint's F and nextPoint's s for each line
          // segment. A constant radius across this capsule follows that rule.
          const segmentRadius = connected
            ? previous.pathWidthUnit * operation.relativeSize
            : operation.pathRadius;
          let overlapWith = null;
          if (connected && operation.pathJoinCorrection && previousPainted) {
            const beforePrevious = index > 1 ? plan.operations[index - 2] : null;
            const priorConnected = beforePrevious && beforePrevious.kind === 'polyline-point' &&
              beforePrevious.segmentKey === previous.segmentKey &&
              (!registry || !registry.contains(index - 2));
            overlapWith = {
              from: priorConnected ? beforePrevious.point : previous.point,
              to: previous.point,
              radius: (priorConnected
                ? beforePrevious.pathWidthUnit * previous.relativeSize
                : previous.pathRadius) * brushSizeMultiplier,
            };
          }
          this.engine.paintPathSegment({
            from: connected ? previous.point : operation.point,
            to: operation.point,
            fromRadius: segmentRadius * brushSizeMultiplier,
            toRadius: segmentRadius * brushSizeMultiplier,
            paintingRectangle: operation.paintingRectangle,
            color: operation.color,
            paintLoad: operation.paintLoad,
            overlapWith,
          });
          markPainted(index, operation);
          onPaint();
          if (ticksPerFrame > 1) await advanceFast();
          previousIndex = index;
          nextIndex = index + 1;
          continue;
        }

        const continuesSegment = activeSegment === operation.segmentKey && previousIndex === index - 1;
        if (!continuesSegment) {
          if (pendingIndex !== null) {
            await waitStep();
            markPainted(pendingIndex, plan.operations[pendingIndex]);
            pendingIndex = null;
          }
          closeStroke();
          this._beginPlanOperation(operation, brushSizeMultiplier);
          activeSegment = operation.segmentKey;
          stats.strokes++;
          markPainted(index, operation); // beginStroke's live contact is immediate
          onPaint();
        } else {
          if (pendingIndex !== null && ticksPerFrame === 1) {
            await waitStep();
            markPainted(pendingIndex, plan.operations[pendingIndex]);
            pendingIndex = null;
          }
          this.engine.strokeTo({
            x: operation.point.x, y: operation.point.y, pressure: operation.pressure,
          });
          onPaint();
          if (ticksPerFrame > 1) {
            await advanceFast();
            markPainted(index, operation);
          } else {
            pendingIndex = index;
          }
        }

        previousIndex = index;
        nextIndex = index + 1;
        if (operation.segmentEnd) {
          if (pendingIndex !== null) {
            await waitStep();
            markPainted(pendingIndex, operation);
            pendingIndex = null;
          }
          closeStroke();
        }
      }

      if (pendingIndex !== null) {
        await waitStep();
        markPainted(pendingIndex, plan.operations[pendingIndex]);
        pendingIndex = null;
      }
      if (timelineEnabled) {
        while (now() - timelineStart - pausedMilliseconds < targetDuration * 1000) {
          await waitUntilReady();
          flushProgress();
          if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
          await waitFrame();
          checkAbort();
        }
        flushProgress();
      }
      closeStroke();
      if (timelineEnabled) {
        stats.targetDuration = targetDuration;
        stats.actualDuration = Math.max(0, (now() - timelineStart - pausedMilliseconds) / 1000);
      }
      return { stats, nextIndex, completed: nextIndex >= plan.operations.length };
    } finally {
      // endStroke() flushes the final live mailbox target. If cancellation
      // lands between strokeTo() and its timed tick, closing the stroke still
      // deposits that endpoint, so acknowledge it exactly once in the registry.
      if (pendingIndex !== null) {
        closeStroke();
        markPainted(pendingIndex, plan.operations[pendingIndex]);
        pendingIndex = null;
      } else {
        closeStroke();
      }
      if (typeof options.resetAdvanceClock === 'function') options.resetAdvanceClock();
      flushProgress();
    }
  }

  _beginPlanOperation(operation, brushSizeMultiplier = 1, offset = null) {
    this.engine.beginStroke({
      timing: 'live',
      randomizeBristles: operation.randomizeBristles !== false && operation.kind === 'polygon-spot',
      x: operation.point.x + (offset ? offset.x : 0),
      y: operation.point.y + (offset ? offset.y : 0),
      pressure: operation.pressure,
      brushSize: operation.brushSize * TILECRAFT_BRUSH_SIZE_CORRECTION_RATE * brushSizeMultiplier,
      paintingRectangle: operation.paintingRectangle,
      color: operation.color,
      resolutionScale: operation.resolutionScale,
      // Omitted entirely when round, so a host engine without shaped-bristle
      // support sees the same beginStroke options it always has.
      ...(operation.brushShape ? { brushShape: operation.brushShape } : {}),
    });
  }

  _boundaryRanges(operations, keyName, labelName) {
    const ranges = [];
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      const previous = ranges[ranges.length - 1];
      if (previous && previous.key === operation[keyName]) {
        previous.end = index + 1;
      } else {
        ranges.push({ start: index, end: index + 1, key: operation[keyName], label: operation[labelName] });
      }
    }
    return ranges.map((range) => Object.freeze(range));
  }

  _frameKey(value) {
    return value === undefined || value === null ? 'frame:unassigned' : `frame:${String(value)}`;
  }

  _frameLabel(value) {
    return value === undefined || value === null ? 'Unassigned frame' : `Frame ${value}`;
  }

  _planProgress(plan, registry, playheadIndex, operation, stats) {
    const pendingOperations = registry ? registry.pendingCount : Math.max(0, plan.operations.length - playheadIndex);
    return {
      status: pendingOperations ? 'playing' : 'completed',
      processedItems: plan.operations.length - pendingOperations,
      totalItems: plan.operations.length,
      processedStrokes: stats.strokes,
      totalStrokes: plan.groupRanges.length,
      layerIndex: operation.layerIndex,
      layerTag: operation.layerTag,
      frameId: operation.frameLabel,
      groupId: operation.groupLabel,
      modelTicks: stats.points,
      playheadIndex,
      paintedOperations: plan.operations.length - pendingOperations,
      pendingOperations,
      pendingRanges: registry ? registry.ranges.length : (pendingOperations ? 1 : 0),
    };
  }

  _abortError() {
    const error = new Error('Tilecraft playback was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  _context(model, options) {
    if (!model || !Array.isArray(model.layers)) {
      throw new TypeError('Tilecraft story model must contain layers[].');
    }
    if (!options || !options.paintingRectangle) {
      throw new TypeError('Tilecraft playback requires options.paintingRectangle.');
    }
    const pathMode = TilecraftStrokePlayer._pathMode(options.pathMode);
    return {
      mapPoint: options.mapPoint || ((tile) => ({ x: tile.x, y: tile.y })),
      resolutionScale: options.resolutionScale === undefined ? 1 : options.resolutionScale,
      alpha: options.alpha === undefined ? 0.04 : options.alpha,
      colorModel: options.colorModel === 'digital' ? 'digital' : 'natural',
      canvasColorFormat: options.canvasColorFormat === 'encoded-rgb' ? 'encoded-rgb' : 'legacy-pigment',
      encodeRgb: options.encodeRgb,
      pressureForSize: options.pressureForSize || ((size, maximum) => maximum > 0 ? size / maximum : 1),
      // The explicit bristle mode restores the pre-GPU canvas-dependent
      // width. All other modes keep the current fixed export width.
      sizeRatio: pathMode === 'bristle'
        ? TilecraftStrokePlayer._legacyCanvasSizeRatio(options.canvasSize)
        : TilecraftStrokePlayer._canvasSizeRatio(options.canvasSize),
      // mapPoint changes coordinate units, so its uniform scale must also be
      // applied to brush widths.  The host that fits a story into a rectangle
      // passes the scale it used for mapPoint here.
      coordinateScale: TilecraftStrokePlayer._positiveOr(options.coordinateScale, 1),
      useScaling: options.useScaling !== false,
      framesScale: options.framesScale,
      pointerId: options.pointerId,
      blackPigment: options.blackPigment !== false,
      // Contacts per stamp. Calibrates spot coverage without touching radius,
      // alpha or any global physics constant.
      spotPaintLoad: TilecraftStrokePlayer._spotPaintLoad(options.spotPaintLoad),
      pathPaintLoad: TilecraftStrokePlayer._spotPaintLoad(options.pathPaintLoad === undefined
        ? TILECRAFT_PATH_PAINT_LOAD : options.pathPaintLoad),
      pathMode,
      pathJoinCorrection: TilecraftStrokePlayer._pathJoinCorrection(options.pathJoinCorrection),
      // How far repeated contacts scatter, as a fraction of the stamp radius.
      // 0 restacks them on one point, which closes no bristle gaps.
      spotScatter: TilecraftStrokePlayer._spotScatter(options.spotScatter),
      spotBristleVariation: options.spotBristleVariation !== false,
      paintingRectangle: options.paintingRectangle,
      stats: {
        layers: 0, strokes: 0, spots: 0, points: 0, skipped: 0,
        // How often the one-pixel floor rewrote a requested radius. Non-zero
        // means tile size ratios were compressed; a whole layer's taper can
        // be flattened on a small canvas.
        minimumRadiusClamped: 0,
      },
    };
  }

  /**
   * Build render units in the legacy layer/primitive order, then make frame
   * identity the outer ordering boundary. This keeps layer/source order stable
   * inside each frame and guarantees one contiguous range per frame.
   */
  _playbackUnits(model, context) {
    const units = [];
    const visible = model.layers.filter((layer) => layer && layer.visible);

    for (const layer of visible) {
      if (TilecraftStrokePlayer.isPathShape(layer.tileShape)) {
      context.stats.layers++;
      for (const segment of this._polylineSegments(layer, context.stats, context)) {
        units.push({
          kind: 'polyline',
          layer,
          segment,
          frameKey: this._frameKey(segment.tiles[0] && segment.tiles[0].f),
        });
      }
      } else if (TilecraftStrokePlayer.isSpotShape(layer.tileShape)) {
      context.stats.layers++;
      for (const tile of layer.tiles || []) {
        if (!this._isDrawableTile(tile)) { context.stats.skipped++; continue; }
        units.push({
          kind: 'polygon',
          layer,
          tile,
          frameKey: this._frameKey(tile.f),
        });
      }
      }
    }

    return this._groupByFrame(units, (unit) => unit.frameKey);
  }

  _groupByFrame(items, keyFor) {
    const buckets = new Map();
    const unassigned = [];
    for (const item of items) {
      const key = keyFor(item);
      if (key === 'frame:unassigned') {
        unassigned.push(item);
      } else {
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(item);
      }
    }
    const frames = [...buckets.values()];
    if (unassigned.length) frames.push(unassigned);
    return frames.flat();
  }

  *_polylineSegments(layer, stats, context) {
    const groups = new Map();
    for (const tile of layer.tiles || []) {
      if (!this._isDrawableTile(tile)) { stats.skipped++; continue; }
      // A group is a logical path. Ungrouped tiles still form one path in their
      // original layer order, which is the schema's render-order guarantee.
      const key = tile.g === undefined ? '__ungrouped__' : tile.g;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tile);
    }

    for (const tiles of groups.values()) {
      // Tilecraft groups can contain tiles with different colours. FluidEngine
      // strokes have one immutable colour, so the first tile defines both the
      // whole group's rendered colour and its colour-order bucket.
      const groupColor = tiles[0].c;
      // `gd` describes the whole Tilecraft group, even when it contains
      // several `b`-separated runs. Resolve it before splitting: bristle mode
      // uses the original group rule; other modes use the current source rule.
      // A FluidEngine stroke has one immutable width, so a path cannot carry
      // a per-tile F the way a spot can.
      const groupScale = context.pathMode === 'bristle'
        ? this._legacyGroupScale(tiles, context)
        : this._tileFrameScale(tiles[0], layer, context);
      let segment = [];
      for (const tile of tiles) {
        const previous = segment[segment.length - 1];
        // `b` starts a new Tilecraft polyline segment. A frame switch and a
        // frame switch cannot be represented by one immutable Stroke API
        // stroke, so it is an explicit lift rather than an accidental bridge.
        const breaks = previous && (
          tile.b > 0 || tile.f !== previous.f
        );
        if (breaks) {
          yield* this._splitByWidth(segment, false, groupScale, groupColor);
          segment = [];
        }
        segment.push(tile);
      }
      if (segment.length) {
        const closes = tiles.length > 2 && tiles.some((tile) => tile.gz === 1);
        yield* this._splitByWidth(segment, closes, groupScale, groupColor);
      }
    }
  }

  /*
   * Split one path where its per-tile `s` changes enough that a single brush
   * width can no longer stand for the whole run.
   *
   * A FluidEngine stroke has ONE immutable brushSize (spacing, zThreshold and
   * splatRadius are fixed at beginStroke), so drawing every point at the
   * segment's widest tile paints a tapered Tilecraft stroke (render.js:445
   * scales each point) entirely at its thick end -- e.g. a 128px frame of
   * pic-3 has 163/164 paths with over 2x internal spread. Splitting into runs
   * of similar width restores the taper while keeping each stroke's width
   * immutable; consecutive runs repeat the boundary tile so pieces overlap and
   * read as one continuous stroke rather than separate dashes.
   */
  *_splitByWidth(tiles, closes, groupScale, groupColor) {
    if (tiles.length < 2) {
      if (tiles.length) yield { tiles, closes, groupScale, groupColor };
      return;
    }
    const sizeOf = (tile) => (tile.s === undefined ? 1 : tile.s);
    let run = [tiles[0]];
    let runMin = sizeOf(tiles[0]);
    let runMax = runMin;
    for (let i = 1; i < tiles.length; i++) {
      const size = sizeOf(tiles[i]);
      const low = Math.min(runMin, size);
      const high = Math.max(runMax, size);
      // A closed path must stay one stroke: splitting it would leave the
      // closing leg attached to the wrong run.
      if (!closes && low > 0 && high / low > WIDTH_SPLIT_RATIO) {
        yield { tiles: run, closes: false, groupScale, groupColor };
        // Repeat the boundary tile so the next run starts where this ended.
        run = [run[run.length - 1], tiles[i]];
        runMin = Math.min(sizeOf(run[0]), size);
        runMax = Math.max(sizeOf(run[0]), size);
        continue;
      }
      run.push(tiles[i]);
      runMin = low;
      runMax = high;
    }
    if (run.length) yield { tiles: run, closes, groupScale, groupColor };
  }

  _replayPolylineSegment(segment, layer, context) {
    const { tiles, closes, groupScale, groupColor } = segment;
    if (this._useAnalyticPath(context)) {
      context.stats.strokes++;
      let previousPrimitive = null;
      for (let i = 0; i < tiles.length; i++) {
        const primitive = this._paintAnalyticSegment(tiles[Math.max(0, i - 1)], tiles[i],
          layer, context, groupColor, previousPrimitive);
        if (primitive) {
          if (i > 0) context.stats.points++;
          previousPrimitive = primitive;
        }
      }
      if (closes && tiles.length > 2 && this._paintAnalyticSegment(
        tiles[tiles.length - 1], tiles[0], layer, context, groupColor,
        previousPrimitive)) context.stats.points++;
      return;
    }
    const sizes = tiles.map((tile) => this._tileSize(tile, layer, context, groupScale));
    const maximumSize = Math.max(...sizes);
    const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
    const first = this._map(tiles[0], layer, context);
    if (!first) { context.stats.skipped += tiles.length; return; }

    this._begin(
      first, tiles[0], maximumSize, layer, context, maximumRelativeSize, 'replay', groupColor
    );
    try {
      for (let i = 1; i < tiles.length; i++) {
        const point = this._map(tiles[i], layer, context);
        if (!point) { context.stats.skipped++; continue; }
        this.engine.strokeTo({
          x: point.x, y: point.y,
          pressure: this._pressure(tiles[i], maximumRelativeSize, context),
        });
        context.stats.points++;
      }
      if (closes && tiles.length > 2) {
        this.engine.strokeTo({ x: first.x, y: first.y,
          pressure: this._pressure(tiles[0], maximumRelativeSize, context) });
        context.stats.points++;
      }
    } finally {
      this.engine.endStroke();
    }
  }

  _replayPolygonTile(tile, layer, context) {
    const point = this._map(tile, layer, context);
    if (!point) { context.stats.skipped++; return; }
    // A spot tile's per-tile `s` maps directly to brushSize. A live sub-tick
    // tap deposits immediately, avoiding ten replay settle frames for every
    // spot in a large Tilecraft layer; `spotPaintLoad` repeats that tap so a
    // single stamp reaches the coverage a path of the same width accumulates.
    const size = this._tileSize(tile, layer, context);
    const relative = tile.s === undefined ? 1 : tile.s;
    const scatter = context.spotScatter * size;
    const seed = TilecraftStrokePlayer._scatterSeed(point.x, point.y);
    this._stampContacts(
      (offset) => this._begin(point, tile, size, layer, context, relative, 'live',
        tile.c, false, offset),
      context.spotPaintLoad,
      () => { context.stats.spots++; },
      scatter, seed
    );
    if (layer.tileShape === 'polygon' && layer.mod == 2 &&
        TilecraftStrokePlayer.brushShape(layer.tileShape, layer, tile)) {
      this._stampContacts(
        (offset) => this._begin(point, tile, size, layer, context, relative, 'live',
          tile.c, true, offset),
        context.spotPaintLoad,
        () => { context.stats.spots++; },
        scatter, seed
      );
    }
  }

  async _playPolylineSegment(segment, layer, context, waitFrame, onPaint, fastTick) {
    const { tiles, closes, groupScale, groupColor } = segment;
    if (this._useAnalyticPath(context)) {
      context.stats.strokes++;
      let previousPrimitive = null;
      for (let i = 0; i < tiles.length; i++) {
        if (i > 0 && !fastTick) await waitFrame();
        const primitive = this._paintAnalyticSegment(tiles[Math.max(0, i - 1)], tiles[i],
          layer, context, groupColor, previousPrimitive);
        if (primitive) {
          if (i > 0) context.stats.points++;
          onPaint();
          previousPrimitive = primitive;
        }
        if (i > 0 && fastTick) await fastTick();
      }
      if (closes && tiles.length > 2) {
        if (!fastTick) await waitFrame();
        if (this._paintAnalyticSegment(tiles[tiles.length - 1], tiles[0], layer,
          context, groupColor, previousPrimitive)) {
          context.stats.points++;
          onPaint();
        }
        if (fastTick) await fastTick();
      }
      return;
    }
    const sizes = tiles.map((tile) => this._tileSize(tile, layer, context, groupScale));
    const maximumSize = Math.max(...sizes);
    const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
    const first = this._map(tiles[0], layer, context);
    if (!first) { context.stats.skipped += tiles.length; return; }

    this._begin(
      first, tiles[0], maximumSize, layer, context, maximumRelativeSize, 'live', groupColor
    );
    onPaint();
    try {
      for (let i = 1; i < tiles.length; i++) {
        if (!fastTick) await waitFrame();
        const point = this._map(tiles[i], layer, context);
        if (!point) { context.stats.skipped++; continue; }
        this.engine.strokeTo({ x: point.x, y: point.y,
          pressure: this._pressure(tiles[i], maximumRelativeSize, context) });
        context.stats.points++;
        onPaint();
        if (fastTick) await fastTick();
      }
      if (closes && tiles.length > 2) {
        if (!fastTick) await waitFrame();
        this.engine.strokeTo({ x: first.x, y: first.y,
          pressure: this._pressure(tiles[0], maximumRelativeSize, context) });
        context.stats.points++;
        onPaint();
        if (fastTick) await fastTick();
      }
      // The final target needs one host frame before lift; otherwise live mode
      // would turn it into an immediate endpoint flush instead of a timed tick.
      if (!fastTick) await waitFrame();
    } finally {
      this.engine.endStroke();
      onPaint();
    }
  }

  _paintAnalyticSegment(fromTile, toTile, layer, context, groupColor, previousPrimitive = null) {
    const from = this._map(fromTile, layer, context);
    const to = this._map(toTile, layer, context);
    if (!from || !to) { context.stats.skipped++; return false; }
    const toRelative = toTile.s === undefined ? 1 : toTile.s;
    const radius = this._pathRadius(fromTile, layer, context, toRelative);
    this.engine.paintPathSegment({
      from, to,
      fromRadius: radius,
      toRadius: radius,
      paintingRectangle: context.paintingRectangle,
      color: this._color(groupColor, layer, context, fromTile),
      paintLoad: context.pathPaintLoad,
      overlapWith: context.pathJoinCorrection ? previousPrimitive : null,
    });
    return { from, to, radius };
  }

  _begin(point, tile, brushSize, layer, context, maximumRelativeSize, timing, color = tile.c,
    alternate = false, offset = null) {
    // The footprint follows the layer's shape whether it paints as a path or
    // as spots: `polyline` is the only path, and it is the only round one.
    const brushShape = TilecraftStrokePlayer.brushShape(layer.tileShape, layer, tile, alternate);
    this.engine.beginStroke({
      timing,
      randomizeBristles: context.spotBristleVariation &&
        TilecraftStrokePlayer.isSpotShape(layer.tileShape),
      x: point.x + (offset ? offset.x : 0),
      y: point.y + (offset ? offset.y : 0),
      pressure: this._pressure(tile, maximumRelativeSize, context),
      brushSize,
      paintingRectangle: context.paintingRectangle,
      color: this._color(color, layer, context, tile),
      resolutionScale: context.resolutionScale,
      ...(brushShape ? { brushShape } : {}),
    });
    context.stats.strokes++;
    context.stats.points++;
  }

  /**
   * Brush radius for one tile, in FluidEngine coordinates. The group/frame
   * scale F comes from `_tileFrameScale()` for EVERY shape -- the source
   * applies it to spots and paths alike -- unless a caller passes a resolved
   * `groupScale`, which a path does so that one immutable stroke width can
   * stand for its whole run.
   */
  /**
   * One engine pixel is the smallest radius the simulation can paint, but the
   * clamp is not free: it compresses the size ratios between small tiles, and
   * on a small canvas it can flatten a whole layer's taper. Counted into
   * `stats.minimumRadiusClamped` (with the smallest unclamped value seen) so a
   * diagnostic can report it instead of it silently rewriting the geometry
   * this specification just fixed.
   */
  _clampRadius(radius, context) {
    if (radius >= 1) return radius;
    context.stats.minimumRadiusClamped++;
    context.stats.smallestRequestedRadius = Math.min(
      context.stats.smallestRequestedRadius === undefined
        ? Infinity : context.stats.smallestRequestedRadius,
      radius
    );
    return 1;
  }

  _tileSize(tile, layer, context, groupScale = undefined) {
    const grid = (layer.gridSize || 1) * (layer.scale === undefined ? 1 : layer.scale);
    const relative = tile.s === undefined ? 1 : tile.s;
    const scale = groupScale === undefined
      ? this._tileFrameScale(tile, layer, context)
      : groupScale;
    if (layer.tileShape === 'polygon' && Number.isInteger(layer.polygonSize) &&
        layer.polygonSize >= 3 && layer.polygonSize <= 8) {
      const sides = layer.polygonSize;
      const areaFraction = sides * Math.sin(2 * Math.PI / sides) / (2 * Math.PI);
      // Tilecraft render.js uses a 0.5 * 1.33 * grid radius. Fluid's polygon
      // shader expands by 1/sqrt(areaFraction), so cancel that expansion here.
      return this._clampRadius(grid * relative * scale * context.coordinateScale *
        0.665 * Math.sqrt(areaFraction), context);
    }
    if (layer.tileShape === 'circle') {
      return this._clampRadius(grid * relative * scale * context.coordinateScale * 0.5, context);
    }
    if (layer.tileShape === 'square' || layer.tileShape === 'rectangle') {
      // render.js draws `fillRect` with half-side 0.5 * G * s * F. Fluid's
      // 4-gon bristle shader puts a VERTEX at the brush radius and divides by
      // sqrt(areaFraction) = sqrt(2/PI), so the painted half-side is
      // cos(PI/4)/sqrt(2/PI) ~= 0.88623 of brushSize. Solve for the radius
      // that lands the half-side on target: 0.5 / 0.88623 ~= 0.56419.
      const squareAreaFraction = 4 * Math.sin(2 * Math.PI / 4) / (2 * Math.PI);
      const paintedHalfSide = Math.cos(Math.PI / 4) / Math.sqrt(squareAreaFraction);
      return this._clampRadius(grid * relative * scale * context.coordinateScale *
        0.5 / paintedHalfSide, context);
    }
    /* A spot whose shape did not match a branch above -- a `polygon` with no
     * usable `polygonSize`, or `slash`. It must NOT fall through to the
     * polyline width: render.js applies `strokeRatio` inside connectPoints()
     * only, so narrowing a stamp by it would shrink spots by a factor the
     * source never applies to them. Treat it as the circle it is drawn as. */
    if (TILECRAFT_SPOT_SHAPES.has(layer.tileShape)) {
      return this._clampRadius(grid * relative * scale * context.coordinateScale * 0.5, context);
    }
    // This is polyline-lcr.js' `rawWidth`: group `gd` correction first, then
    // the export stroke ratio.  coordinateScale puts that source-space width
    // into the same FluidEngine coordinates returned by mapPoint.
    return this._clampRadius(
      grid * relative * scale * context.sizeRatio * context.coordinateScale, context);
  }

  /** Tilecraft's polyline size is a line WIDTH; the GPU capsule takes radius. */
  _pathRadius(tile, layer, context, relative = tile.s === undefined ? 1 : tile.s) {
    const grid = (layer.gridSize || 1) * (layer.scale === undefined ? 1 : layer.scale);
    return 0.5 * grid * relative * this._tileFrameScale(tile, layer, context) *
      context.sizeRatio * context.coordinateScale;
  }

  /**
   * Group ranges in the shape render-core.js' getGroupedRanges() builds them:
   * keyed by raw `g`, with `dist` measured from the group's FIRST tile to the
   * last tile that updated it, across the whole layer and before any `b` or
   * width split. Cached on the context because every tile of every layer asks
   * for it.
   *
   * Visibility is filtered after grouping in the source, so hidden tiles
   * still update the group's distance and ordered gd state.
   */
  _groupedRanges(layer, context) {
    if (!context.groupedRanges) context.groupedRanges = new Map();
    const cached = context.groupedRanges.get(layer);
    if (cached) return cached;
    const ranges = new Map();
    for (const tile of layer.tiles || []) {
      if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      const key = tile.g;
      const range = ranges.get(key);
      if (!range) {
        ranges.set(key, { firstTile: tile, lastTile: tile, dist: undefined });
      } else {
        range.lastTile = tile;
        range.dist = Math.hypot(tile.x - range.firstTile.x, tile.y - range.firstTile.y);
      }
    }
    // render-core.js updates distRatio as it visits each source tile. Cache
    // each resulting value so compile order cannot change the answer.
    const scales = new Map();
    for (const tile of layer.tiles || []) {
      if (!tile || !Number.isFinite(tile.x) || !Number.isFinite(tile.y)) continue;
      const range = ranges.get(tile.g);
      if (tile.g && tile.gd > 0) range.distRatio = tile.gd / range.dist;
      let scale = 1;
      if (range.distRatio && range.distRatio > 0 && range.distRatio !== Infinity) {
        scale = Math.max(1 / range.distRatio, 0.1);
      } else if (!range.distRatio && context.framesScale && tile.g != context.pointerId) {
        const rate = context.framesScale[tile.f];
        if (rate < 1) scale = rate;
      }
      scales.set(tile, scale);
    }
    ranges.scales = scales;
    context.groupedRanges.set(layer, ranges);
    return ranges;
  }

  /**
   * The single source of truth for a tile's group/frame scale, ported from
   * render-core.js' tileFrameScale(). Both paths and spots must come through
   * here: the source applies it to every tileShape, and the previous
   * path-only helper diverged from it in four ways that must not be carried
   * into the spot branch --
   *
   *   - it had no 0.1 lower bound;
   *   - it added a `distance < 5000` guard the source does not have, which
   *     silently dropped F to 1 on wide groups;
   *   - it took `gd` from the first tile carrying one, where the source reads
   *     each tile's own `gd` and recomputes distRatio from it;
   *   - it measured `dist` on the already-split segment, so after
   *     `_splitByWidth()` and `b` breaks its endpoints were not the source
   *     group's firstTile/lastTile.
   *
   * Consequence accepted deliberately: this changes polyline widths too. The
   * reference is now the source renderer, not the previous Fluid behaviour.
   */
  _tileFrameScale(tile, layer, context) {
    if (!tile) return 1;
    if (!context.useScaling) return 1;
    return this._groupedRanges(layer, context).scales.get(tile) ?? 1;
  }

  /** The group-width calculation used by the original bristle polyline path. */
  _legacyGroupScale(tiles, context) {
    const first = tiles[0];
    const last = tiles[tiles.length - 1];
    if (context.useScaling && first && last && first.g) {
      const gdTile = tiles.find((tile) => Number.isFinite(tile.gd) && tile.gd > 0);
      if (gdTile) {
        const distance = Math.hypot(last.x - first.x, last.y - first.y);
        if (distance > 0 && distance < 5000) return distance / gdTile.gd;
      }
    }
    const frameScale = context.framesScale && context.framesScale[first && first.f];
    if (first && first.g !== context.pointerId &&
        Number.isFinite(frameScale) && frameScale < 0.9) return frameScale;
    return 1;
  }

  _pressure(tile, maximumSize, context) {
    const size = tile.s === undefined ? 1 : tile.s;
    const value = context.pressureForSize(size, maximumSize, tile);
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
  }

  _color(hex, layer, context, tile = null) {
    const rgba = context.canvasColorFormat === 'encoded-rgb'
      ? TilecraftStrokePlayer.hexToEncodedRgb(hex, context.encodeRgb)
      : TilecraftStrokePlayer.hexToPigment(hex, context.blackPigment, context.colorModel);
    const layerOpacity = layer.opacity === undefined ? 1 : layer.opacity / 255;
    const tileOpacity = Number.isFinite(tile?.a) ? Math.max(0, Math.min(255, tile.a)) / 255 : 1;
    return {
      space: 'pigment',
      channels: rgba.slice(0, 3),
      alpha: Math.max(0, Math.min(1, context.alpha * layerOpacity * tileOpacity * rgba[3])),
    };
  }

  _map(tile, layer, context) {
    const point = context.mapPoint(tile, layer);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return point;
  }

  _isDrawableTile(tile) {
    return tile && Number.isFinite(tile.x) && Number.isFinite(tile.y) &&
      typeof tile.c === 'string' && tile.v !== 0;
  }

  /** #RRGGBB[A] -> the nearest display-matching RYB pigment load. */
  static hexToPigment(hex, blackPigment = true, colorModel = 'natural') {
    const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(hex || '');
    if (!match) throw new TypeError(`Tilecraft colour must be #RRGGBB or #RRGGBBAA, got ${hex}.`);
    const rgb = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
    const alpha = match[2] === undefined ? 1 : parseInt(match[2], 16) / 255;
    return [...(colorModel === 'digital'
      ? [1 - rgb[1], 1 - rgb[0], 1 - rgb[2]]
      : TilecraftStrokePlayer.rgbToPigment(rgb, blackPigment)), alpha];
  }

  /** #RRGGBB[A] -> encoded RGB material for hosts that render with COLOR_MODEL.RGB. */
  static hexToEncodedRgb(hex, encodeRgb = (rgb) => [1 - rgb[1], 1 - rgb[0], 1 - rgb[2]]) {
    const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(hex || '');
    if (!match) throw new TypeError(`Tilecraft colour must be #RRGGBB or #RRGGBBAA, got ${hex}.`);
    const rgb = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
    const alpha = match[2] === undefined ? 1 : parseInt(match[2], 16) / 255;
    return [...encodeRgb(rgb), alpha];
  }

  /**
   * Stroke-width narrowing, ported from Tilecraft's thickness-scale.js.
   *
   * The source is `thicknessScale.ofCanvas(EXPORT_BASE)` -- the value
   * render.js receives as `taskContext.strokeRatio` and multiplies into
   * `gridScaledSize` for polylines. Every EXPORT consumer (PDF, PNG, three
   * and Fluid, which thickness-scale.js names explicitly) passes the fixed
   * EXPORT_BASE, so the ratio is a CONSTANT. Only the interactive editor
   * passes its own canvas diagonal.
   *
   * This previously computed `min(1, max(width, height) / 3000)`, which
   * diverged three ways: it varied with the Fluid canvas where the source is
   * constant, it compared against the long SIDE where the source uses the
   * REFERENCE DIAGONAL (hypot(3000, 1875) = 3536), and it fed in the live
   * canvas instead of EXPORT_BASE. On a 1900px canvas that painted strokes
   * 1.49x the source width; on an 800px one, 0.63x -- a width that changed
   * with the window, which is exactly the hidden per-canvas factor section
   * 3.2 of the spot-parity spec forbids.
   *
   * `canvasSize` is retained in the signature because the editor branch of
   * the source formula needs it, and a host emulating the editor can pass it;
   * absent that, export behaviour is the correct default.
   */
  static _canvasSizeRatio(canvasSize) {
    // thickness-scale.js: REFERENCE is the diagonal of the 3000x1875 canvas
    // the models were drawn against; EXPORT_BASE is the export canvas.
    const REFERENCE = Math.hypot(3000, 1875);
    const EXPORT_BASE = 1500;
    const base = TilecraftStrokePlayer._editorThicknessBase(canvasSize);
    return Math.min(1, (base === undefined ? EXPORT_BASE : base) / REFERENCE);
  }

  /** Pre-GPU Fluid canvas width rule, used only by explicit bristle mode. */
  static _legacyCanvasSizeRatio(canvasSize) {
    if (!canvasSize) return 1;
    const maximum = Math.max(Number(canvasSize.width), Number(canvasSize.height));
    return Number.isFinite(maximum) && maximum > 0 ? Math.min(1, maximum / 3000) : 1;
  }

  /**
   * The editor branch of thicknessScale: the DIAGONAL of the host canvas,
   * used only when a host explicitly asks to be scaled like the editor rather
   * than like an export. Returns undefined for the export default.
   */
  static _editorThicknessBase(canvasSize) {
    if (!canvasSize || canvasSize.thicknessBase !== 'editor') return undefined;
    const diagonal = Math.hypot(Number(canvasSize.width) || 0, Number(canvasSize.height) || 0);
    return Number.isFinite(diagonal) && diagonal > 0 ? diagonal : undefined;
  }

  static _positiveOr(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** Scatter radius as a fraction of the stamp radius; 0 disables it. */
  static _spotScatter(value) {
    if (value === undefined) return TILECRAFT_SPOT_SCATTER;
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError('Tilecraft spotScatter must be a fraction of the radius in [0, 1].');
    }
    return value;
  }

  /** Contacts per stamp: a positive integer, defaulting to the calibrated load. */
  static _spotPaintLoad(value) {
    if (value === undefined) return TILECRAFT_SPOT_PAINT_LOAD;
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError('Tilecraft spotPaintLoad must be a positive integer number of contacts.');
    }
    return value;
  }

  /** auto preserves the previous capability-based choice. */
  static _pathMode(value) {
    if (value === undefined) return 'auto';
    if (value !== 'auto' && value !== 'gpu' && value !== 'bristle') {
      throw new TypeError('Tilecraft pathMode must be auto, gpu or bristle.');
    }
    return value;
  }

  static _pathJoinCorrection(value) {
    if (value === undefined) return true;
    if (typeof value !== 'boolean') {
      throw new TypeError('Tilecraft pathJoinCorrection must be a boolean.');
    }
    return value;
  }

  _useAnalyticPath(context) {
    if (context.pathMode === 'bristle') return false;
    if (typeof this.engine.paintPathSegment === 'function') return true;
    if (context.pathMode === 'gpu') {
      throw new Error('Tilecraft GPU path playback requires paintPathSegment().');
    }
    return false;
  }

  /**
   * Deposit one stamp as `load` contacts scattered around its point.
   *
   * A live beginStroke() makes exactly one contact and a live strokeTo() only
   * moves the target mailbox, so repeating strokeTo() at an unchanged position
   * deposits nothing -- the lever has to be the number of presses. Each
   * begin/end pair is one contact, which is the same stationary splat the
   * engine's own replay timing repeats STROKE_SETTLE_STEPS times.
   *
   * `beginOnce(offset)` receives the per-contact offset in engine units. The
   * first contact is always centred so a load of 1 is exactly the old
   * behaviour and the mark's nominal position never moves.
   *
   * Every contact is reported through `onContact` so a caller that counts
   * engine strokes, marks progress or yields a frame still sees each one.
   */
  _stampContacts(beginOnce, load, onContact, radius = 0, seed = 0) {
    for (let contact = 0; contact < load; contact++) {
      beginOnce(this._scatterOffset(contact, load, radius, seed));
      this.engine.endStroke();
      if (onContact) onContact();
    }
  }

  /**
   * Offset for one contact of a scattered stamp.
   *
   * Deterministic by construction -- derived from the contact index and a seed
   * taken from the mark itself, never from a stateful generator -- because the
   * player must compile and replay a model identically on every run, and
   * backward frame navigation repaints from a plan that was built earlier.
   *
   * The contacts walk a golden-angle spiral, which spreads them evenly instead
   * of clustering the way independent uniform samples would at these tiny
   * counts; the seed rotates the whole spiral so neighbouring marks do not
   * share a pattern and tile into a visible texture.
   */
  _scatterOffset(contact, load, radius, seed) {
    if (contact === 0 || !(radius > 0) || load < 2) return null;
    const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
    // sqrt keeps the sample density even across the disc rather than crowding
    // the centre, the same equal-area trick the bristle layout uses.
    const distance = radius * Math.sqrt(contact / (load - 1));
    const angle = contact * GOLDEN_ANGLE + seed * 2 * Math.PI;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }

  /** A stable [0,1) seed for one mark, so its scatter never changes between runs. */
  static _scatterSeed(x, y) {
    // A cheap integer hash of the quantised position: neighbouring marks get
    // unrelated seeds, and the same mark always gets the same one.
    let hash = Math.imul(Math.round(x * 16) | 0, 0x27d4eb2d) ^
      Math.imul(Math.round(y * 16) | 0, 0x165667b1);
    hash = Math.imul(hash ^ (hash >>> 15), 0x2545f491);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  }

  // The same subtractive cube as painting.frag.  Its channel order is Red,
  // Blue, Yellow (not the literal spelling of “RYB”).
  static rybToRgb(ryb, blackPigment = true) {
    const c = [
      [1, 1, 1], [1, 0, 0], [0.163, 0.373, 0.6], [1, 1, 0],
      [1, 0.5, 0], [0, 0.66, 0.2], [0.5, 0, 0.5],
      blackPigment ? [0, 0, 0] : [0.2, 0.094, 0],
    ];
    const [x, y, z] = ryb;
    const weights = [
      (1 - x) * (1 - y) * (1 - z), x * (1 - y) * (1 - z),
      (1 - x) * y * (1 - z), (1 - x) * (1 - y) * z,
      x * (1 - y) * z, (1 - x) * y * z,
      x * y * (1 - z), x * y * z,
    ];
    return [0, 1, 2].map((channel) => c.reduce((sum, corner, i) => sum + corner[channel] * weights[i], 0));
  }

  /** Invert the engine's RYB display cube numerically, clamped to its gamut. */
  static rgbToPigment(rgb, blackPigment = true) {
    const key = `${blackPigment ? 1 : 0}:${rgb.map((value) => value.toFixed(6)).join(',')}`;
    if (!TilecraftStrokePlayer._pigmentCache) TilecraftStrokePlayer._pigmentCache = new Map();
    const cached = TilecraftStrokePlayer._pigmentCache.get(key);
    if (cached) return cached.slice();
    const errorFor = (pigment) => TilecraftStrokePlayer.rybToRgb(pigment, blackPigment)
      .reduce((sum, value, i) => sum + (value - rgb[i]) ** 2, 0);
    let best = [0, 0, 0], bestError = Infinity;
    // A small global lattice avoids a local minimum, then coordinate descent
    // gives a stable sub-byte inverse without an external colour dependency.
    for (let xi = 0; xi <= 8; xi++) for (let yi = 0; yi <= 8; yi++) for (let zi = 0; zi <= 8; zi++) {
      const candidate = [xi / 8, yi / 8, zi / 8];
      const error = errorFor(candidate);
      if (error < bestError) { best = candidate; bestError = error; }
    }
    for (let step = 1 / 8; step >= 1 / 2048; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
          const candidate = best.slice();
          candidate[axis] = Math.max(0, Math.min(1, candidate[axis] + direction * step));
          const error = errorFor(candidate);
          if (error + 1e-15 < bestError) { best = candidate; bestError = error; improved = true; }
        }
      }
    }
    TilecraftStrokePlayer._pigmentCache.set(key, best.slice());
    return best;
  }
}

TilecraftStrokePlayer.brushSizeCorrectionRate = TILECRAFT_BRUSH_SIZE_CORRECTION_RATE;

if (typeof module !== 'undefined' && module.exports) module.exports = TilecraftStrokePlayer;
if (typeof globalThis !== 'undefined') globalThis.TilecraftStrokePlayer = TilecraftStrokePlayer;
