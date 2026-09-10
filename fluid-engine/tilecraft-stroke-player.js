// Tilecraft story-model adapter for FluidEngine's public Stroke API.
//
// This is deliberately outside FluidEngine: Tilecraft's JSON, #RRGGBB colours,
// layer rules and canvas-coordinate transform belong to the importing host, not
// to the fluid simulation.  The adapter never reads engine.brush/simulator.

const TILECRAFT_BRUSH_SIZE_CORRECTION_RATE = 0.5;

class TilecraftStrokePlayer {
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
        this._begin(point, tile, this._tileSize(tile, layer, context), layer, context,
          tile.s === undefined ? 1 : tile.s, 'live');
        this.engine.endStroke();
        stats.spots++;
        onPaint();
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

    for (const { layer, layerIndex } of visible.filter(({ layer }) => layer.tileShape === 'polyline')) {
      context.stats.layers++;
      let segmentOrdinal = 0;
      for (const segment of this._polylineSegments(layer, context.stats, context)) {
        const { tiles, closes, groupScale } = segment;
        const sizes = tiles.map((tile) => this._tileSize(tile, layer, context, groupScale));
        const brushSize = Math.max(...sizes);
        const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
        const firstTile = tiles[0];
        const frameKey = this._frameKey(firstTile && firstTile.f);
        const rawGroup = firstTile && firstTile.g !== undefined
          ? String(firstTile.g)
          : `ungrouped-${segmentOrdinal}`;
        const segmentKey = `${layerIndex}:${frameKey}:${rawGroup}:${segmentOrdinal}`;
        const mapped = [];
        tiles.forEach((tile, sourceTileIndex) => {
          const point = this._map(tile, layer, context);
          if (!point) { context.stats.skipped++; return; }
          mapped.push({ tile, sourceTileIndex, point });
        });
        if (!mapped.length) { segmentOrdinal++; continue; }

        const color = this._color(segment.groupColor, layer, context);
        mapped.forEach((entry, pointIndex) => {
          operations.push({
            kind: 'polyline-point',
            layerIndex,
            layerTag: layer.tag,
            frameKey,
            frameLabel: this._frameLabel(firstTile.f),
            groupKey: segmentKey,
            groupLabel: firstTile.g === undefined ? `Group ${segmentOrdinal + 1}` : `Group ${firstTile.g}`,
            segmentKey,
            segmentStart: pointIndex === 0,
            segmentEnd: pointIndex === mapped.length - 1 && !closes,
            point: entry.point,
            pressure: this._pressure(entry.tile, maximumRelativeSize, context),
            brushSize,
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
    }

    for (const { layer, layerIndex } of visible.filter(({ layer }) => layer.tileShape === 'polygon')) {
      context.stats.layers++;
      for (let sourceTileIndex = 0; sourceTileIndex < (layer.tiles || []).length; sourceTileIndex++) {
        const tile = layer.tiles[sourceTileIndex];
        if (!this._isDrawableTile(tile)) { context.stats.skipped++; continue; }
        const point = this._map(tile, layer, context);
        if (!point) { context.stats.skipped++; continue; }
        const frameKey = this._frameKey(tile.f);
        const groupKey = `${layerIndex}:${frameKey}:spot-${sourceTileIndex}`;
        operations.push({
          kind: 'polygon-spot',
          layerIndex,
          layerTag: layer.tag,
          frameKey,
          frameLabel: this._frameLabel(tile.f),
          groupKey,
          groupLabel: `Spot ${sourceTileIndex + 1}`,
          point,
          pressure: this._pressure(tile, tile.s === undefined ? 1 : tile.s, context),
          brushSize: this._tileSize(tile, layer, context),
          color: this._color(tile.c, layer, context),
          paintingRectangle: context.paintingRectangle,
          resolutionScale: context.resolutionScale,
          sourceTileIndex,
        });
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

    const checkAbort = () => {
      if (options.signal && options.signal.aborted) throw this._abortError();
    };
    const waitUntilReady = async () => {
      checkAbort();
      if (typeof options.waitUntilResumed === 'function') {
        await options.waitUntilResumed(options.signal);
      }
      checkAbort();
    };
    const waitStep = async () => {
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
      onProgress(this._planProgress(plan, registry, index + 1, operation, stats));
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
        this.engine.endStroke();
        activeSegment = null;
        onPaint();
      }
    };

    try {
      for (let index = startIndex; index < stopAt; index++) {
        nextIndex = index;
        await waitUntilReady();
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
          this._beginPlanOperation(operation, brushSizeMultiplier);
          stats.strokes++;
          this.engine.endStroke();
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
      closeStroke();
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
    }
  }

  _beginPlanOperation(operation, brushSizeMultiplier = 1) {
    this.engine.beginStroke({
      timing: 'live',
      x: operation.point.x,
      y: operation.point.y,
      pressure: operation.pressure,
      brushSize: operation.brushSize * TILECRAFT_BRUSH_SIZE_CORRECTION_RATE * brushSizeMultiplier,
      paintingRectangle: operation.paintingRectangle,
      color: operation.color,
      resolutionScale: operation.resolutionScale,
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
    return {
      mapPoint: options.mapPoint || ((tile) => ({ x: tile.x, y: tile.y })),
      resolutionScale: options.resolutionScale === undefined ? 1 : options.resolutionScale,
      alpha: options.alpha === undefined ? 0.04 : options.alpha,
      pressureForSize: options.pressureForSize || ((size, maximum) => maximum > 0 ? size / maximum : 1),
      // Tilecraft's polyline-lcr renderer narrows strokes on canvases below
      // its 3000px reference size.  This must be the destination canvas size,
      // not the story bounds: it is the same `cw`/`ch` input as sizeRatio().
      sizeRatio: TilecraftStrokePlayer._canvasSizeRatio(options.canvasSize),
      // mapPoint changes coordinate units, so its uniform scale must also be
      // applied to brush widths.  The host that fits a story into a rectangle
      // passes the scale it used for mapPoint here.
      coordinateScale: TilecraftStrokePlayer._positiveOr(options.coordinateScale, 1),
      useScaling: options.useScaling !== false,
      framesScale: options.framesScale,
      pointerId: options.pointerId,
      blackPigment: options.blackPigment !== false,
      paintingRectangle: options.paintingRectangle,
      stats: { layers: 0, strokes: 0, spots: 0, points: 0, skipped: 0 },
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

    for (const layer of visible.filter((candidate) => candidate.tileShape === 'polyline')) {
      context.stats.layers++;
      for (const segment of this._polylineSegments(layer, context.stats, context)) {
        units.push({
          kind: 'polyline',
          layer,
          segment,
          frameKey: this._frameKey(segment.tiles[0] && segment.tiles[0].f),
        });
      }
    }
    for (const layer of visible.filter((candidate) => candidate.tileShape === 'polygon')) {
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
      // several `b`-separated runs.  Calculate it before splitting so every
      // run gets the renderer's same group scale.
      const groupScale = this._groupScale(tiles, context);
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
          yield { tiles: segment, closes: false, groupScale, groupColor };
          segment = [];
        }
        segment.push(tile);
      }
      if (segment.length) {
        const closes = tiles.length > 2 && tiles.some((tile) => tile.gz === 1);
        yield { tiles: segment, closes, groupScale, groupColor };
      }
    }
  }

  _replayPolylineSegment(segment, layer, context) {
    const { tiles, closes, groupScale, groupColor } = segment;
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
    // A polygon tile is a spot: its per-tile `s` maps directly to brushSize.
    // A live sub-tick tap deposits immediately, avoiding ten replay settle
    // frames for every spot in a large Tilecraft layer.
    this._begin(point, tile, this._tileSize(tile, layer, context), layer, context,
      tile.s === undefined ? 1 : tile.s, 'live');
    this.engine.endStroke();
    context.stats.spots++;
  }

  async _playPolylineSegment(segment, layer, context, waitFrame, onPaint, fastTick) {
    const { tiles, closes, groupScale, groupColor } = segment;
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

  _begin(point, tile, brushSize, layer, context, maximumRelativeSize, timing, color = tile.c) {
    this.engine.beginStroke({
      timing,
      x: point.x, y: point.y,
      pressure: this._pressure(tile, maximumRelativeSize, context),
      brushSize,
      paintingRectangle: context.paintingRectangle,
      color: this._color(color, layer, context),
      resolutionScale: context.resolutionScale,
    });
    context.stats.strokes++;
    context.stats.points++;
  }

  _tileSize(tile, layer, context, groupScale = 1) {
    const grid = (layer.gridSize || 1) * (layer.scale === undefined ? 1 : layer.scale);
    const relative = tile.s === undefined ? 1 : tile.s;
    // This is polyline-lcr.js' `rawWidth`: group `gd` correction first,
    // then responsive canvas ratio.  coordinateScale puts that source-space
    // width into the same FluidEngine coordinates returned by mapPoint.
    return Math.max(1, grid * relative * groupScale * context.sizeRatio * context.coordinateScale);
  }

  _groupScale(tiles, context) {
    const first = tiles[0];
    const last = tiles[tiles.length - 1];
    if (context.useScaling && first && last && first.g) {
      const gdTile = tiles.find((tile) => Number.isFinite(tile.gd) && tile.gd > 0);
      if (gdTile) {
        const distance = Math.hypot(last.x - first.x, last.y - first.y);
        // Same guard as Tilecraft render.js / polyline-lcr.js.  `gd` is the
        // original group distance, so its reciprocal distRatio shrinks or
        // grows the visual width with the transformed path.
        if (distance > 0 && distance < 5000) return distance / gdTile.gd;
      }
    }
    const frameScale = context.framesScale && context.framesScale[first && first.f];
    if (first && first.g !== context.pointerId && Number.isFinite(frameScale) && frameScale < 0.9) {
      return frameScale;
    }
    return 1;
  }

  _pressure(tile, maximumSize, context) {
    const size = tile.s === undefined ? 1 : tile.s;
    const value = context.pressureForSize(size, maximumSize, tile);
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
  }

  _color(hex, layer, context) {
    const rgba = TilecraftStrokePlayer.hexToPigment(hex, context.blackPigment);
    const layerOpacity = layer.opacity === undefined ? 1 : layer.opacity / 255;
    return {
      space: 'pigment',
      channels: rgba.slice(0, 3),
      alpha: Math.max(0, Math.min(1, context.alpha * layerOpacity * rgba[3])),
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
  static hexToPigment(hex, blackPigment = true) {
    const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(hex || '');
    if (!match) throw new TypeError(`Tilecraft colour must be #RRGGBB or #RRGGBBAA, got ${hex}.`);
    const rgb = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
    const alpha = match[2] === undefined ? 1 : parseInt(match[2], 16) / 255;
    return [...TilecraftStrokePlayer.rgbToPigment(rgb, blackPigment), alpha];
  }

  static _canvasSizeRatio(canvasSize) {
    if (!canvasSize) return 1;
    const width = Number(canvasSize.width);
    const height = Number(canvasSize.height);
    const maximum = Math.max(width, height);
    return Number.isFinite(maximum) && maximum > 0 ? Math.min(1, maximum / 3000) : 1;
  }

  static _positiveOr(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
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
