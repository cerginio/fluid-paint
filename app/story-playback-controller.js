'use strict';

class StoryPlaybackController {
  constructor(painter) {
    this.painter = painter;
    this.engine = painter.engine;
    this.state = 'empty';
    this.model = null;
    this.modelSummary = null;
    this.plan = null;
    this.registry = new UnpaintedRangeRegistry();
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.speed = 1;
    this.thickness = 1;
    this.canvasPolicy = 'overlay';
    this.colorModel = 'natural';
    /* Contacts per imported stamp. `undefined` takes the player's calibrated
     * default; this is the single point to retune spot coverage without
     * touching brush radius, colour alpha or any global physics constant. It
     * is read at compile time and frozen into the plan, so changing it needs a
     * recompile rather than affecting a run already in flight. */
    this.spotPaintLoad = undefined;
    this.pathPaintLoad = undefined;
    this.spotScatter = undefined;
    this.pathMode = undefined;
    this.pathJoinCorrection = undefined;
    this.spotBristleVariation = undefined;
    this._readPaintingParameters();
    this.listeners = new Set();
    this.baseline = null;
    this.baselineValid = false;
    this._abortController = null;
    this._runPromise = null;
    this._pauseResolve = null;
    this._paused = false;
    this._storyTickCounter = null;
    this.maxRate = null;
    this._configurationPromise = Promise.resolve();
    this.activeRunSettings = null;
    this.lastStats = null;
    this.targetDuration = 0;
    this.elapsed = 0;
    this.estimatedRemaining = 0;
    this.backgroundSummary = null;
    this.backgroundError = null;
    this.backgroundLoading = false;
    this.fileError = null;
  }

  get canPaintManually() {
    return true;
  }

  /** Optional URL overrides for comparing imported story rendering. */
  _readPaintingParameters() {
    if (typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    const values = [
      ['pathMode', (raw) => TilecraftStrokePlayer._pathMode(raw)],
      ['spotPaintLoad', (raw) => TilecraftStrokePlayer._spotPaintLoad(Number(raw))],
      ['pathPaintLoad', (raw) => TilecraftStrokePlayer._spotPaintLoad(Number(raw))],
      ['spotScatter', (raw) => TilecraftStrokePlayer._spotScatter(Number(raw))],
      ['spotBristleVariation', (raw) => {
        if (raw !== '0' && raw !== '1') throw new TypeError('expected 0 or 1');
        return raw === '1';
      }],
      ['pathJoinCorrection', (raw) => {
        if (raw !== '0' && raw !== '1') throw new TypeError('expected 0 or 1');
        return raw === '1';
      }],
    ];
    for (const [name, parse] of values) {
      if (!params.has(name)) continue;
      try {
        this[name] = parse(params.get(name));
      } catch (error) {
        console.warn(`[story] ignoring ${name}:`, error.message);
      }
    }
  }

  getModelViewport(padding = 24) {
    return {
      width: this.painter.paintingRectangle.width,
      height: this.painter.paintingRectangle.height,
      padding,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this._viewModel());
    return () => this.listeners.delete(listener);
  }

  async loadFile(file) {
    const isPng = file && (file.type === 'image/png' || /\.png$/i.test(file.name || ''));
    if (isPng) return this.loadBackgroundFile(file);
    try {
      const loaded = await StoryFileLoader.load(file);
      await this.loadModel(loaded.model, loaded.summary);
    } catch (error) {
      this.fileError = error;
      if (this.model) this._emit();
      else this._setState('file-error');
      throw error;
    }
  }

  async loadBackgroundFile(file) {
    this.backgroundLoading = true;
    this.backgroundError = null;
    this._emit();
    try {
      if (this.state === 'playing' || this.state === 'paused') await this.yieldToManualInput();
      this.backgroundSummary = await this.painter.loadBackgroundImage(file);
      this._emit();
      return { kind: 'background', summary: this.backgroundSummary };
    } catch (error) {
      this.backgroundError = error;
      this._emit();
      throw error;
    } finally {
      this.backgroundLoading = false;
      this._emit();
    }
  }

  removeBackground() {
    if (!this.backgroundSummary) return false;
    this.painter.clearBackgroundImage();
    this.backgroundSummary = null;
    this.backgroundError = null;
    this._emit();
    return true;
  }

  /** A bake commits the visible canvas as the new, irreversible baseline. */
  acceptBakedBackground(summary) {
    this.baselineValid = false;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.targetDuration = 0;
    this.elapsed = 0;
    this.estimatedRemaining = 0;
    this.backgroundSummary = summary;
    this.backgroundError = null;
    this._setState(this.model ? 'ready' : 'empty');
  }

  async loadModel(model, summary) {
    await this._cancelRun();
    this.model = model;
    this.modelSummary = summary || StoryFileLoader.summarize(model);
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.targetDuration = 0;
    this.elapsed = 0;
    this.estimatedRemaining = 0;
    this.error = null;
    this.fileError = null;
    this.baselineValid = false;
    this._setState('ready');
  }

  /**
   * Commit a fully staged transfer. Product modes may transfer a playable JSON
   * model, a PNG reference, or both.
   */
  async loadScene({ model, background, transferId } = {}) {
    if (!model && !background) throw new TypeError('A transferred scene requires a model or background.');
    await this._cancelRun();
    if (background) {
      this.painter.engine.setBackgroundImage(background.source || background);
      this.painter.needsRedraw = true;
      this.backgroundSummary = background.summary || {
        fileName: 'background.png',
        byteSize: 0,
        sourceWidth: null,
        sourceHeight: null,
        transferId: transferId || null,
      };
      this.backgroundError = null;
    }
    this.model = model || null;
    this.modelSummary = model ? StoryFileLoader.summarize(model, 'tilecraft-transfer.json') : null;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.error = null;
    this.fileError = null;
    this.baselineValid = false;
    this._setState('ready');
  }

  async removeFile() {
    await this._cancelRun();
    this.model = null;
    this.modelSummary = null;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.baselineValid = false;
    this.fileError = null;
    this._setState('empty');
  }

  setSpeed(multiplier) {
    if (![0.25, 0.5, 1, 2, 4, 8, 16, 'max'].includes(multiplier)) {
      throw new RangeError('Unsupported story playback speed.');
    }
    if (this.speed === multiplier) return Promise.resolve(false);
    this.speed = multiplier;
    this.maxRate = null;
    if (this.plan) {
      const total = this.plan.operations.length;
      const painted = total - this.registry.pendingCount;
      if (this.speed === 'max') {
        // Max promises no duration: its ETA comes only from measurement.
        this.targetDuration = null;
        this.estimatedRemaining = null;
      } else {
        this.targetDuration = TilecraftStrokePlayer.targetPlaySeconds(total) / this.speed;
        this.elapsed = total ? this.targetDuration * painted / total : 0;
        this.estimatedRemaining = Math.max(0, this.targetDuration - this.elapsed);
      }
    }
    this._emit();
    return this._reconfigureActiveRun();
  }

  setThickness(multiplier) {
    if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 2.5) {
      throw new RangeError('Story thickness must be between 0.1 and 2.5.');
    }
    const normalized = Math.round(multiplier * 100) / 100;
    if (this.thickness === normalized) return Promise.resolve(false);
    this.thickness = normalized;
    this._emit();
    return this._reconfigureActiveRun();
  }

  setCanvasPolicy(policy) {
    if (policy !== 'replace' && policy !== 'overlay') {
      throw new TypeError('Canvas policy must be replace or overlay.');
    }
    this.canvasPolicy = policy;
    this._emit();
  }

  setColorModel(model) {
    if (model !== 'natural' && model !== 'digital') {
      throw new TypeError('Story color model must be natural or digital.');
    }
    this.colorModel = model;
    this._emit();
    return true;
  }

  _applyColorModel() {
    const digital = this.colorModel === 'digital';
    this.painter.setPaletteMode?.(digital ? 'digital' : 'natural');
  }

  async play() {
    if (!this.model) return false;
    if (this.state === 'paused') return this.resume();
    if (this.state === 'completed-with-gaps') return this.playEarliestRemaining();
    if (this.state === 'completed') return this.restart();
    if (this.state !== 'ready') return false;
    try {
      this._prepareFreshRun();
    } catch (error) {
      if (this.baselineValid) this.painter.applySnapshot(this.baseline);
      this.error = error;
      this._setState('ready');
      throw error;
    }
    return this._runFrom(0);
  }

  pause() {
    if (this.state !== 'playing') return false;
    this._paused = true;
    this.engine.resetClock(performance.now() / 1000);
    this._setState('paused');
    return true;
  }

  async yieldToManualInput() {
    if (this.state === 'playing' || this.state === 'paused') {
      await this._cancelRun();
      this._paused = true;
      this.engine.resetClock(performance.now() / 1000);
      this._setState('paused');
      return 'paused';
    }
    if (['stop-decision', 'completed', 'completed-with-gaps', 'player-error'].includes(this.state)) {
      this.keepResult();
      return 'kept';
    }
    return 'unchanged';
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'completed-with-gaps') return false;
    this._paused = false;
    if (this._pauseResolve) {
      const resolve = this._pauseResolve;
      this._pauseResolve = null;
      resolve();
    }
    this.engine.resetClock(performance.now() / 1000);
    if (this._runPromise) {
      this._setState('playing');
      return this._runPromise;
    }
    return this._runFrom(this.playheadIndex);
  }

  async restart() {
    if (!this.model) return false;
    await this._cancelRun();
    this.baselineValid = false;
    try {
      this._prepareFreshRun();
    } catch (error) {
      if (this.baselineValid) this.painter.applySnapshot(this.baseline);
      this.baselineValid = false;
      this.error = error;
      this._setState('ready');
      throw error;
    }
    return this._runFrom(0);
  }

  async stop() {
    if (!['playing', 'paused'].includes(this.state)) return false;
    await this._cancelRun();
    this.keepResult();
    return true;
  }

  async restoreBaseline() {
    await this._cancelRun();
    if (this.baselineValid && this.baseline) {
      this.painter.applySnapshot(this.baseline);
      this.painter.needsRedraw = true;
    }
    this.baselineValid = false;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this._setState(this.model ? 'ready' : 'empty');
    return true;
  }

  keepResult() {
    if (!['playing', 'paused', 'stop-decision', 'completed', 'completed-with-gaps', 'player-error'].includes(this.state)) {
      return false;
    }
    this.baselineValid = false;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this._setState(this.model ? 'ready' : 'empty');
    return true;
  }

  previousUnpaintedFrame() { return this._navigate('previous-frame'); }
  nextFrame() { return this._navigate('next-frame'); }

  async playEarliestRemaining() {
    if (!this.plan) return false;
    const pending = this.registry.earliestPending();
    if (!pending) return false;
    await this._cancelRun();
    this.playheadIndex = pending.start;
    return this._runFrom(pending.start);
  }

  getPendingRanges() {
    return this.registry.snapshot();
  }

  async _navigate(kind) {
    if (!this.plan || !['playing', 'paused', 'completed-with-gaps'].includes(this.state)) return false;
    const shouldResume = this.state === 'playing';
    await this._cancelRun();
    let destination = null;
    if (kind === 'next-frame') {
      destination = this.registry.nextFrameBoundary(this.playheadIndex, this.plan);
      if (destination !== null) {
        const skippedEnd = destination > this.playheadIndex
          ? destination
          : this.plan.operations.length;
        if (this.playheadIndex < skippedEnd) {
          this.registry.markJump(this.playheadIndex, skippedEnd, 'frame-jump');
        }
      }
    } else if (kind === 'previous-frame') {
      const range = this.registry.previousPendingFrame(this.playheadIndex, this.plan);
      destination = range && range.start;
    }
    if (destination === null) {
      this._setState(shouldResume ? 'playing' : 'paused');
      if (shouldResume) return this._runFrom(this.playheadIndex);
      return false;
    }
    this.playheadIndex = destination;
    this._syncProgressPosition();
    if (shouldResume) return this._runFrom(destination);
    this._setState('paused');
    return true;
  }

  _prepareFreshRun() {
    this._applyColorModel();
    this._captureBaseline();
    if (this.canvasPolicy === 'replace') this.engine.clear();
    this.painter.needsRedraw = true;
    this.plan = this._compilePlan();
    this.registry.reset(this.plan.operations.length);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress(this.plan.operations.length);
    this.error = null;
    this._resetTiming();
  }

  _captureBaseline() {
    // Put the pre-story state into the app's normal undo history once. Keeping
    // a completed/partial result can then be undone like any other paint action.
    if (!this.baselineValid) this.painter.saveSnapshot();
    if (!this.baseline) {
      this.baseline = this.engine.createSnapshot(
        this.painter.paintingRectangle.width,
        this.painter.paintingRectangle.height,
        this.painter.resolutionScale
      );
    }
    this.engine.saveSnapshot(
      this.baseline,
      this.painter.paintingRectangle.width,
      this.painter.paintingRectangle.height,
      this.painter.resolutionScale
    );
    this.baselineValid = true;
  }

  _compilePlan() {
    const target = this.painter.paintingRectangle.clone();
    const fit = this.model?.fit;
    if (this._isValidFit(fit)) {
      const player = new TilecraftStrokePlayer(this.engine);
      this.player = player;
      return player.compile(this.model, {
        paintingRectangle: target,
        resolutionScale: this.painter.getEffectiveResolutionScale(),
        canvasSize: { width: target.width, height: target.height },
        coordinateScale: 1,
        blackPigment: this.painter.blackPigment,
        colorModel: this.colorModel,
        canvasColorFormat: 'encoded-rgb',
        encodeRgb: (rgb) => PaintColorAdapter.encodeRgb(rgb),
        alpha: this.painter._strokeColor().alpha,
        spotPaintLoad: this.spotPaintLoad,
        pathPaintLoad: this.pathPaintLoad,
        spotScatter: this.spotScatter,
        spotBristleVariation: this.spotBristleVariation,
        pathMode: this.pathMode,
        pathJoinCorrection: this.pathJoinCorrection,
        mapPoint: (tile) => ({
          x: target.left + tile.x,
          y: target.bottom + fit.height - tile.y,
        }),
      });
    }
    const bounds = this.modelSummary.bounds;
    const sourceWidth = Math.max(1, bounds.right - bounds.left);
    const sourceHeight = Math.max(1, bounds.bottom - bounds.top);
    const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
    const offsetX = target.left + (target.width - sourceWidth * scale) / 2;
    const offsetY = target.bottom + (target.height - sourceHeight * scale) / 2;
    const player = new TilecraftStrokePlayer(this.engine);
    this.player = player;
    return player.compile(this.model, {
      paintingRectangle: target,
      resolutionScale: this.painter.getEffectiveResolutionScale(),
      canvasSize: { width: target.width, height: target.height },
      coordinateScale: scale,
      blackPigment: this.painter.blackPigment,
      colorModel: this.colorModel,
      canvasColorFormat: 'encoded-rgb',
      encodeRgb: (rgb) => PaintColorAdapter.encodeRgb(rgb),
      alpha: this.painter._strokeColor().alpha,
      spotPaintLoad: this.spotPaintLoad,
      pathPaintLoad: this.pathPaintLoad,
      spotScatter: this.spotScatter,
      spotBristleVariation: this.spotBristleVariation,
      pathMode: this.pathMode,
      pathJoinCorrection: this.pathJoinCorrection,
      mapPoint: (tile) => ({
        x: offsetX + (tile.x - bounds.left) * scale,
        y: offsetY + (bounds.bottom - tile.y) * scale,
      }),
    });
  }

  _isValidFit(fit) {
    if (fit?.version !== 1 || !Number.isFinite(fit.width) || !Number.isFinite(fit.height) ||
        fit.width <= 0 || fit.height <= 0 || fit.width > 8192 || fit.height > 8192 ||
        !Number.isFinite(fit.padding) || fit.padding < 0 ||
        fit.padding >= Math.min(fit.width, fit.height) / 2 ||
        !Number.isFinite(fit.scale) || fit.scale <= 0) return false;
    const bounds = fit.sourceBounds;
    return bounds && ['left', 'top', 'right', 'bottom'].every((key) => Number.isFinite(bounds[key]));
  }

  async _runFrom(startIndex) {
    if (!this.plan || !this.plan.operations.length) return false;
    this._paused = false;
    const abortController = new AbortController();
    this._abortController = abortController;
    this._setState('playing');
    const runSettings = Object.freeze({ speed: this.speed, thickness: this.thickness });
    this.activeRunSettings = runSettings;
    const total = this.plan.operations.length;
    const remainingFraction = total ? this.registry.pendingCount / total : 0;
    const max = runSettings.speed === 'max';
    const runTargetDuration = max ? null : this.targetDuration * remainingFraction;
    const runElapsedBase = this.elapsed;
    const meter = max ? this._startRateMeter(total) : null;
    /* Denser bristles for imported stamps, restored in the finally below.
     * A stamp is one press, so its coverage is whatever a single sunflower of
     * bristles paints; the brush slider is the user's choice for their own
     * brush and must come back untouched. setBrush() refuses mid-stroke, so
     * this has to straddle the whole run rather than wrap each stamp. */
    const userBristleCount = this._applySpotBristleCount();
    const player = this.player || new TilecraftStrokePlayer(this.engine);
    const run = player.playPlan(this.plan, {
      startIndex,
      registry: this.registry,
      signal: abortController.signal,
      waitUntilResumed: (signal) => this._waitUntilResumed(signal),
      waitFrame: () => new Promise(requestAnimationFrame),
      targetDuration: runTargetDuration,
      tickScheduler: max ? new TilecraftStrokePlayer.BudgetTickScheduler() : undefined,
      brushSizeMultiplier: runSettings.thickness,
      advanceTick: () => this._advanceStoryTick(),
      resetAdvanceClock: () => this._resetStoryClock(),
      onPaint: () => { this.painter.needsRedraw = true; },
      onProgress: (progress) => {
        this.progress = progress;
        this.playheadIndex = progress.playheadIndex;
        const paintedFraction = total ? progress.paintedOperations / total : 1;
        this.elapsed = Number.isFinite(progress.timelineElapsed)
          ? runElapsedBase + progress.timelineElapsed
          : this.targetDuration * paintedFraction;
        if (meter) {
          this._sampleRate(meter, progress);
        } else {
          this.estimatedRemaining = Math.max(0, this.targetDuration - this.elapsed);
        }
        this.painter.needsRedraw = true;
        this._emit();
      },
    });
    this._runPromise = run;
    try {
      const result = await run;
      this.lastStats = result.stats;
      this.playheadIndex = result.nextIndex;
      if (!abortController.signal.aborted) {
        this.elapsed = runElapsedBase + (result.stats.actualDuration ?? runTargetDuration ?? 0);
        this.estimatedRemaining = 0;
        this._setState(this.registry.pendingCount ? 'completed-with-gaps' : 'completed');
      }
      return result.stats;
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.error = error;
        this.baselineValid = false;
        this.plan = null;
        this._setState('ready');
        throw error;
      }
      return false;
    } finally {
      if (meter) this._storyTickCounter = null;
      this._restoreBristleCount(userBristleCount);
      if (this._abortController === abortController) this._abortController = null;
      if (this._runPromise === run) this._runPromise = null;
    }
  }

  /**
   * Raise the bristle count for spot playback, returning the user's value to
   * restore. Returns null when the policy is off or nothing needs changing.
   */
  _applySpotBristleCount() {
    /* Read through globalThis, not the bare names. These are top-level `const`
     * in paint-setup.js, which the bundle concatenates AFTER this file, and a
     * `typeof` guard does not protect a const in its temporal dead zone -- it
     * throws ReferenceError. Playback only ever starts after every script has
     * run, but a property lookup states that independence instead of relying
     * on it. */
    const policy = globalThis.StoryBristlePolicy;
    if (!policy || !policy.auto) return null;
    const wanted = globalThis.STORY_SPOT_BRISTLE_COUNT;
    if (!Number.isFinite(wanted)) return null;
    // The brush's textures are sized at maxBristleCount; asking for more would
    // sample outside them rather than fail loudly.
    const target = Math.min(wanted, this.engine.maxBristleCount);
    const previous = this.engine.bristleCount;
    if (previous === target) return null;
    try {
      this.engine.setBrush({ bristleCount: target });
    } catch (_) {
      // A stroke was somehow active: playback is still correct at the user's
      // count, so paint rather than abort the run over a density preference.
      return null;
    }
    return previous;
  }

  _restoreBristleCount(previous) {
    if (previous === null) return;
    try {
      this.engine.setBrush({ bristleCount: previous });
    } catch (_) { /* restored on the next run; never fail a finished playback */ }
  }

  async _cancelRun() {
    const run = this._runPromise;
    if (!run) return;
    if (this._abortController) this._abortController.abort();
    this._releasePause();
    try { await run; } catch (_) { /* _runFrom owns non-abort reporting */ }
  }

  _reconfigureActiveRun() {
    if (this.state !== 'playing' && !(this.state === 'paused' && this._runPromise)) {
      return Promise.resolve(false);
    }
    const reconfigure = async () => {
      if (this.state !== 'playing' && this.state !== 'paused') return false;
      await this._cancelRun();
      if (this.state === 'playing') {
        this._runFrom(this.playheadIndex).catch((error) => {
          console.error('Story playback reconfiguration:', error);
        });
      } else if (this.state === 'paused') {
        this._paused = true;
        this._setState('paused');
      } else {
        return false;
      }
      return true;
    };
    const queued = this._configurationPromise.then(reconfigure, reconfigure);
    this._configurationPromise = queued.catch(() => {});
    return queued;
  }

  _waitUntilResumed(signal) {
    if (!this._paused) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this._pauseResolve = null;
        const error = new Error('Tilecraft playback was cancelled.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal && signal.aborted) { onAbort(); return; }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      this._pauseResolve = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(true);
      };
    });
  }

  _releasePause() {
    this._paused = false;
    if (this._pauseResolve) {
      const resolve = this._pauseResolve;
      this._pauseResolve = null;
      resolve();
    }
  }

  /* One story tick is exactly one engine step (INV-MAX-1). The former
   * synthetic advance() clock let a slow tick add interpolated steps, so the
   * painting depended on how ticks were grouped into frames. */
  _advanceStoryTick() {
    this.engine.stepTick();
    if (this._storyTickCounter) this._storyTickCounter.ticks++;
  }

  _resetStoryClock() {
    this.engine.resetClock(performance.now() / 1000);
  }

  /** True while a run feeds the engine its ticks; the host must not add its own. */
  get ownsEngineClock() {
    return this.state === 'playing' && this._runPromise !== null;
  }

  /* Max reports what it measures: operations and ticks per second over a
   * sliding one-second window, published at most twice a second. */
  _startRateMeter(total) {
    const counter = { ticks: 0 };
    this._storyTickCounter = counter;
    this.maxRate = null;
    this.estimatedRemaining = null;
    const start = performance.now();
    return { counter, total, samples: [{ time: start, ticks: 0, operations: null }],
      start, publishedAt: -Infinity };
  }

  _sampleRate(meter, progress) {
    const time = performance.now();
    const samples = meter.samples;
    if (samples[0].operations === null) samples[0].operations = progress.paintedOperations;
    samples.push({ time, ticks: meter.counter.ticks, operations: progress.paintedOperations });
    while (samples.length > 2 && time - samples[1].time >= 1000) samples.shift();
    if (time - meter.start < 1000 || time - meter.publishedAt < 500) return;
    const first = samples[0];
    const seconds = (time - first.time) / 1000;
    if (seconds <= 0) return;
    const operationsPerSecond = (progress.paintedOperations - first.operations) / seconds;
    const ticksPerSecond = (meter.counter.ticks - first.ticks) / seconds;
    const oneXSeconds = TilecraftStrokePlayer.targetPlaySeconds(meter.total);
    const oneXRate = oneXSeconds > 0 ? meter.total / oneXSeconds : 0;
    meter.publishedAt = time;
    this.maxRate = {
      multiplier: oneXRate > 0 ? operationsPerSecond / oneXRate : 0,
      ticksPerSecond,
    };
    this.estimatedRemaining = operationsPerSecond > 0
      ? progress.pendingOperations / operationsPerSecond : null;
  }

  _syncProgressPosition() {
    const total = this.plan ? this.plan.operations.length : 0;
    const operation = this.plan && this.plan.operations[
      Math.min(this.playheadIndex, Math.max(0, total - 1))
    ];
    this.progress = {
      ...this.progress,
      totalItems: total,
      playheadIndex: this.playheadIndex,
      frameId: operation && operation.frameLabel,
      groupId: operation && operation.groupLabel,
      paintedOperations: total - this.registry.pendingCount,
      pendingOperations: this.registry.pendingCount,
      pendingRanges: this.registry.ranges.length,
    };
    this._emit();
  }

  _emptyProgress(totalItems = 0) {
    return {
      processedItems: 0, totalItems, processedStrokes: 0, totalStrokes: 0,
      playheadIndex: 0, paintedOperations: 0, pendingOperations: totalItems,
      pendingRanges: totalItems ? 1 : 0,
    };
  }

  _resetTiming() {
    const count = this.plan?.operations?.length || 0;
    this.maxRate = null;
    this.elapsed = 0;
    if (this.speed === 'max') {
      this.targetDuration = null;
      this.estimatedRemaining = null;
      return;
    }
    this.targetDuration = TilecraftStrokePlayer.targetPlaySeconds(count) / this.speed;
    this.estimatedRemaining = this.targetDuration;
  }

  _setState(state) {
    this.state = state;
    const body = document.getElementById('panel-body');
    if (body) body.inert = false;
    this._emit();
  }

  _viewModel() {
    const canNavigate = !!this.plan;
    return {
      state: this.state,
      modelSummary: this.modelSummary,
      progress: { ...this.progress },
      speed: this.speed,
      maxRate: this.maxRate ? { ...this.maxRate } : null,
      thickness: this.thickness,
      activeRunSettings: this.activeRunSettings,
      backgroundSummary: this.backgroundSummary,
      backgroundError: this.backgroundError,
      backgroundLoading: this.backgroundLoading,
      canvasPolicy: this.canvasPolicy,
      colorModel: this.colorModel,
      error: this.error,
      fileError: this.fileError,
      targetDuration: this.targetDuration,
      elapsed: this.elapsed,
      estimatedRemaining: this.estimatedRemaining,
      pendingRanges: this.registry.snapshot(),
      canPaintManually: this.canPaintManually,
      canPreviousFrame: canNavigate && !!this.registry.previousPendingFrame(this.playheadIndex, this.plan),
      canNextFrame: canNavigate && this.registry.nextFrameBoundary(this.playheadIndex, this.plan) !== null,
    };
  }

  _emit() {
    const value = this._viewModel();
    this.listeners.forEach((listener) => listener(value));
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = StoryPlaybackController;
if (typeof globalThis !== 'undefined') globalThis.StoryPlaybackController = StoryPlaybackController;
