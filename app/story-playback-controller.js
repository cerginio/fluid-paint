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
    this.speed = 8;
    this.thickness = 1;
    this.canvasPolicy = 'replace';
    this.listeners = new Set();
    this.baseline = null;
    this.baselineValid = false;
    this._abortController = null;
    this._runPromise = null;
    this._pauseResolve = null;
    this._paused = false;
    this._storyClock = undefined;
    this._configurationPromise = Promise.resolve();
    this.activeRunSettings = null;
    this.lastStats = null;
    this.backgroundSummary = null;
    this.backgroundError = null;
    this.backgroundLoading = false;
  }

  get canPaintManually() {
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this._viewModel());
    return () => this.listeners.delete(listener);
  }

  async loadFile(file) {
    const isPng = file && (file.type === 'image/png' || /\.png$/i.test(file.name || ''));
    if (isPng) return this.loadBackgroundFile(file);
    this._setState('loading');
    try {
      const loaded = await StoryFileLoader.load(file);
      await this.loadModel(loaded.model, loaded.summary);
    } catch (error) {
      this.error = error;
      this._setState('file-error');
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

  async loadModel(model, summary) {
    await this._cancelRun();
    this.model = model;
    this.modelSummary = summary || StoryFileLoader.summarize(model);
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.error = null;
    this.baselineValid = false;
    this._setState('ready');
  }

  async removeFile() {
    await this._cancelRun();
    if (this.baselineValid) await this.restoreBaseline();
    this.model = null;
    this.modelSummary = null;
    this.plan = null;
    this.registry.reset(0);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress();
    this.baselineValid = false;
    this._setState('empty');
  }

  setSpeed(multiplier) {
    if (![0.25, 0.5, 1, 2, 4, 8, 16].includes(multiplier)) {
      throw new RangeError('Unsupported story playback speed.');
    }
    if (this.speed === multiplier) return Promise.resolve(false);
    this.speed = multiplier;
    this._emit();
    return this._reconfigureActiveRun();
  }

  setThickness(multiplier) {
    if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 1.2) {
      throw new RangeError('Story thickness must be between 0.1 and 1.2.');
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
    if (this.state === 'playing' || this.state === 'paused') return;
    this.canvasPolicy = policy;
    this._emit();
  }

  async play() {
    if (!this.model) return false;
    if (this.state === 'paused') return this.resume();
    if (this.state === 'completed-with-gaps') return this.playEarliestRemaining();
    if (this.state === 'completed') return this.restart();
    if (this.state !== 'ready') return false;
    this._prepareFreshRun();
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
    if (this.baselineValid) this.painter.applySnapshot(this.baseline);
    else this._captureBaseline();
    if (this.canvasPolicy === 'replace') this.engine.clear();
    this.painter.needsRedraw = true;
    this.plan = this._compilePlan();
    this.registry.reset(this.plan.operations.length);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress(this.plan.operations.length);
    return this._runFrom(0);
  }

  async stop() {
    if (!['playing', 'paused'].includes(this.state)) return false;
    await this._cancelRun();
    this._setState('stop-decision');
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
    if (!['stop-decision', 'completed', 'completed-with-gaps', 'player-error'].includes(this.state)) {
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
    this._captureBaseline();
    if (this.canvasPolicy === 'replace') this.engine.clear();
    this.painter.needsRedraw = true;
    this.plan = this._compilePlan();
    this.registry.reset(this.plan.operations.length);
    this.playheadIndex = 0;
    this.progress = this._emptyProgress(this.plan.operations.length);
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
      mapPoint: (tile) => ({
        x: offsetX + (tile.x - bounds.left) * scale,
        y: offsetY + (bounds.bottom - tile.y) * scale,
      }),
    });
  }

  async _runFrom(startIndex) {
    if (!this.plan || !this.plan.operations.length) return false;
    this._paused = false;
    const abortController = new AbortController();
    this._abortController = abortController;
    this._setState('playing');
    const runSettings = Object.freeze({ speed: this.speed, thickness: this.thickness });
    this.activeRunSettings = runSettings;
    const speedOptions = runSettings.speed < 1
      ? { framesPerStep: Math.round(1 / runSettings.speed), ticksPerFrame: 1 }
      : { framesPerStep: 1, ticksPerFrame: Math.round(runSettings.speed) };
    const player = this.player || new TilecraftStrokePlayer(this.engine);
    const run = player.playPlan(this.plan, {
      startIndex,
      registry: this.registry,
      signal: abortController.signal,
      waitUntilResumed: (signal) => this._waitUntilResumed(signal),
      waitFrame: () => new Promise(requestAnimationFrame),
      ...speedOptions,
      brushSizeMultiplier: runSettings.thickness,
      advanceTick: () => this._advanceStoryTick(),
      resetAdvanceClock: () => this._resetStoryClock(),
      onPaint: () => { this.painter.needsRedraw = true; },
      onProgress: (progress) => {
        this.progress = progress;
        this.playheadIndex = progress.playheadIndex;
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
        this._setState(this.registry.pendingCount ? 'completed-with-gaps' : 'completed');
      }
      return result.stats;
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.error = error;
        this._setState('player-error');
        throw error;
      }
      return false;
    } finally {
      if (this._abortController === abortController) this._abortController = null;
      if (this._runPromise === run) this._runPromise = null;
    }
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
    if (!this._paused) return Promise.resolve();
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
        resolve();
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

  _advanceStoryTick() {
    const wallNow = performance.now() / 1000;
    this._storyClock = Math.max(this._storyClock === undefined ? wallNow : this._storyClock, wallNow) + 1 / 60;
    this.engine.advance(this._storyClock);
  }

  _resetStoryClock() {
    this.engine.resetClock(performance.now() / 1000);
    this._storyClock = undefined;
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
      thickness: this.thickness,
      activeRunSettings: this.activeRunSettings,
      backgroundSummary: this.backgroundSummary,
      backgroundError: this.backgroundError,
      backgroundLoading: this.backgroundLoading,
      canvasPolicy: this.canvasPolicy,
      error: this.error,
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
