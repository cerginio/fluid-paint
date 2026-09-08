// Tilecraft story-model adapter for FluidEngine's public Stroke API.
//
// This is deliberately outside FluidEngine: Tilecraft's JSON, #RRGGBB colours,
// layer rules and canvas-coordinate transform belong to the importing host, not
// to the fluid simulation.  The adapter never reads engine.brush/simulator.

class TilecraftStrokePlayer {
  constructor(engine) {
    if (!engine || typeof engine.beginStroke !== 'function' ||
        typeof engine.strokeTo !== 'function' || typeof engine.endStroke !== 'function') {
      throw new TypeError('TilecraftStrokePlayer requires the public FluidEngine Stroke API.');
    }
    this.engine = engine;
  }

  /**
   * Replay a Tilecraft render model. Polyline layers are intentionally first,
   * then polygon layers as independent paint spots, as required by the player
   * pipeline. Other Tilecraft primitive families are ignored.
   *
   * `mapPoint(tile, layer)` is the coordinate-boundary hook. It must return
   * finite bottom-left-origin engine coordinates; the model itself stays in its
   * own canvas coordinate space. The identity mapping is useful when both
   * spaces already agree.
   */
  replay(model, options) {
    const context = this._context(model, options);
    const { stats } = context;

    const visible = model.layers.filter((layer) => layer && layer.visible);
    for (const layer of visible.filter((layer) => layer.tileShape === 'polyline')) {
      stats.layers++;
      this._replayPolylineLayer(layer, context);
    }
    for (const layer of visible.filter((layer) => layer.tileShape === 'polygon')) {
      stats.layers++;
      this._replayPolygonLayer(layer, context);
    }
    return stats;
  }

  /**
   * Animate the same model through live strokes. A host's normal RAF loop must
   * call engine.advance(); this method deliberately only feeds its input
   * mailbox once per supplied frame. `onPaint` is where a host marks its
   * presentation dirty after a programmatic input update.
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
    const waitStep = async () => {
      for (let i = 0; i < framesPerStep; i++) await waitFrame();
    };
    const onPaint = options.onPaint || (() => {});
    const { stats } = context;
    const visible = model.layers.filter((layer) => layer && layer.visible);

    for (const layer of visible.filter((candidate) => candidate.tileShape === 'polyline')) {
      stats.layers++;
      for (const segment of this._polylineSegments(layer, stats, context)) {
        await this._playPolylineSegment(segment, layer, context, waitStep, onPaint);
      }
    }
    for (const layer of visible.filter((candidate) => candidate.tileShape === 'polygon')) {
      stats.layers++;
      for (const tile of layer.tiles || []) {
        if (!this._isDrawableTile(tile)) { stats.skipped++; continue; }
        const point = this._map(tile, layer, context);
        if (!point) { stats.skipped++; continue; }
        await waitStep();
        this._begin(point, tile, this._tileSize(tile, layer, context), layer, context,
          tile.s === undefined ? 1 : tile.s, 'live');
        this.engine.endStroke();
        stats.spots++;
        onPaint();
      }
    }
    return stats;
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

  _replayPolylineLayer(layer, context) {
    for (const segment of this._polylineSegments(layer, context.stats, context)) {
      this._replayPolylineSegment(segment, layer, context);
    }
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
      // `gd` describes the whole Tilecraft group, even when it contains
      // several `b`-separated runs.  Calculate it before splitting so every
      // run gets the renderer's same group scale.
      const groupScale = this._groupScale(tiles, context);
      let segment = [];
      for (const tile of tiles) {
        const previous = segment[segment.length - 1];
        // `b` starts a new Tilecraft polyline segment. A frame switch and a
        // colour switch also cannot be represented by one immutable Stroke API
        // stroke, so they are explicit lifts rather than accidental bridges.
        const breaks = previous && (
          tile.b > 0 || tile.f !== previous.f || tile.c !== previous.c
        );
        if (breaks) {
          yield { tiles: segment, closes: false, groupScale };
          segment = [];
        }
        segment.push(tile);
      }
      if (segment.length) {
        const closes = tiles.length > 2 && tiles.some((tile) => tile.gz === 1);
        yield { tiles: segment, closes, groupScale };
      }
    }
  }

  _replayPolylineSegment(segment, layer, context) {
    const { tiles, closes, groupScale } = segment;
    const sizes = tiles.map((tile) => this._tileSize(tile, layer, context, groupScale));
    const maximumSize = Math.max(...sizes);
    const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
    const first = this._map(tiles[0], layer, context);
    if (!first) { context.stats.skipped += tiles.length; return; }

    this._begin(first, tiles[0], maximumSize, layer, context, maximumRelativeSize, 'replay');
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

  _replayPolygonLayer(layer, context) {
    for (const tile of layer.tiles || []) {
      if (!this._isDrawableTile(tile)) { context.stats.skipped++; continue; }
      const point = this._map(tile, layer, context);
      if (!point) { context.stats.skipped++; continue; }
      // A polygon tile is a spot: its per-tile `s` maps directly to brushSize.
      // A live sub-tick tap deposits immediately, avoiding ten replay settle
      // frames for every spot in a large Tilecraft layer.
      this._begin(point, tile, this._tileSize(tile, layer, context), layer, context,
        tile.s === undefined ? 1 : tile.s, 'live');
      this.engine.endStroke();
      context.stats.spots++;
    }
  }

  async _playPolylineSegment(segment, layer, context, waitFrame, onPaint) {
    const { tiles, closes, groupScale } = segment;
    const sizes = tiles.map((tile) => this._tileSize(tile, layer, context, groupScale));
    const maximumSize = Math.max(...sizes);
    const maximumRelativeSize = Math.max(...tiles.map((tile) => tile.s === undefined ? 1 : tile.s));
    const first = this._map(tiles[0], layer, context);
    if (!first) { context.stats.skipped += tiles.length; return; }

    this._begin(first, tiles[0], maximumSize, layer, context, maximumRelativeSize, 'live');
    onPaint();
    try {
      for (let i = 1; i < tiles.length; i++) {
        await waitFrame();
        const point = this._map(tiles[i], layer, context);
        if (!point) { context.stats.skipped++; continue; }
        this.engine.strokeTo({ x: point.x, y: point.y,
          pressure: this._pressure(tiles[i], maximumRelativeSize, context) });
        context.stats.points++;
        onPaint();
      }
      if (closes && tiles.length > 2) {
        await waitFrame();
        this.engine.strokeTo({ x: first.x, y: first.y,
          pressure: this._pressure(tiles[0], maximumRelativeSize, context) });
        context.stats.points++;
        onPaint();
      }
      // The final target needs one host frame before lift; otherwise live mode
      // would turn it into an immediate endpoint flush instead of a timed tick.
      await waitFrame();
    } finally {
      this.engine.endStroke();
      onPaint();
    }
  }

  _begin(point, tile, brushSize, layer, context, maximumRelativeSize, timing) {
    this.engine.beginStroke({
      timing,
      x: point.x, y: point.y,
      pressure: this._pressure(tile, maximumRelativeSize, context),
      brushSize,
      paintingRectangle: context.paintingRectangle,
      color: this._color(tile.c, layer, context),
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

if (typeof module !== 'undefined' && module.exports) module.exports = TilecraftStrokePlayer;
if (typeof globalThis !== 'undefined') globalThis.TilecraftStrokePlayer = TilecraftStrokePlayer;
