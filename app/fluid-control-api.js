(function (root) {
  'use strict';

  const MODES = Object.freeze({
    'fluid-play': {
      wants: Object.freeze(['model']),
      ui: Object.freeze({ mode: 'empty' }),
      commands: Object.freeze([
        'play', 'pause', 'restart', 'setPlaybackSpeed', 'setPlaybackThickness',
        'setDrawingEnabled',
      ]),
    },
    'fluid-rescript': {
      wants: Object.freeze(['background']),
      ui: Object.freeze({
        mode: 'preset',
        preset: 'draw-min',
        features: Object.freeze(['brush-options', 'state-bake']),
      }),
      commands: Object.freeze(['setPaintColor', 'setPaintSize', 'clearPaint']),
    },
  });

  function controlError(code, message, details = {}) {
    return Object.assign(new Error(message), { code, details });
  }

  function pigmentToHsva([r, g, b, alpha = 1]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = ((hue / 6) + 1) % 1;
    }
    return [hue, max ? delta / max : 0, max, alpha];
  }

  // A palette hex is a requested DISPLAY colour. Natural Fluid paint stores
  // pigment loads, so treating the RGB channels as pigment (the old path)
  // produces a different visible colour after the RYB cube is rendered.
  function hexToPaintHsva(hex) {
    const converter = root.TilecraftStrokePlayer;
    if (!converter?.hexToPigment) {
      throw controlError('PAINT_COLOR_CONVERTER_UNAVAILABLE', 'RGB-to-pigment conversion is unavailable');
    }
    return pigmentToHsva(converter.hexToPigment(hex));
  }

  class FluidControlApi {
    constructor(painter, controller) {
      this.painter = painter;
      this.controller = controller;
      this.mode = null;
      this.transferId = null;
      this.palette = [];
      this.reducedMotion = false;
      this.allowDrawing = true;
      this.autoplay = true;
      this.listeners = new Set();
      this.unsubscribeController = controller.subscribe(() => this._emit());
    }

    configureMode(mode, {
      palette = [],
      reducedMotion = false,
      allowDrawing = true,
      autoplay = true,
      playbackSpeed = 1,
    } = {}) {
      const definition = MODES[mode];
      if (!definition) throw controlError('UNKNOWN_FLUID_MODE', `Unknown Fluid mode: ${String(mode)}`);
      if (!Array.isArray(palette)) throw controlError('INVALID_PALETTE', 'palette must be an array');
      if (palette.some((color) => typeof color !== 'string' ||
          (color !== 'white' && color !== 'black' && !/^#[0-9a-f]{6}$/i.test(color)))) {
        throw controlError('INVALID_PALETTE', 'Palette colors must be white, black, or six-digit hex values');
      }
      this.mode = mode;
      this.transferId = null;
      this.allowDrawing = mode === 'fluid-rescript' ? true : !!allowDrawing;
      this.autoplay = mode === 'fluid-play' ? autoplay !== false : false;
      const manualEnabled = mode === 'fluid-rescript' || this.allowDrawing;
      if (typeof this.painter.setManualPaintingEnabled === 'function') {
        this.painter.setManualPaintingEnabled(manualEnabled);
      } else {
        this.painter.manualPaintingEnabled = manualEnabled;
      }
      this.reducedMotion = !!reducedMotion;
      if (typeof document !== 'undefined') {
        document.documentElement.toggleAttribute('data-reduced-motion', this.reducedMotion);
      }
      if (mode === 'fluid-play') this.controller.setSpeed(this.reducedMotion ? 1 : Number(playbackSpeed));
      this.palette = [...palette];
      this._emit();
      return definition;
    }

    activateTransfer(transferId) {
      this.transferId = transferId;
      this._emit();
    }

    startAutoplay(transferId) {
      if (!this.autoplay || !this.transferId || transferId !== this.transferId) return false;
      queueMicrotask(() => {
        if (!this.autoplay || transferId !== this.transferId) return;
        Promise.resolve(this.controller.play()).catch(() => {
          // StoryPlaybackController publishes the structured error state.
        });
      });
      return true;
    }

    async execute({ transferId, command, value } = {}) {
      if (!this.transferId || transferId !== this.transferId) {
        throw controlError('STALE_TRANSFER', 'The control command does not belong to the active scene', {
          expected: this.transferId,
          received: transferId || null,
        });
      }
      const definition = MODES[this.mode];
      if (!definition?.commands.includes(command) && command !== 'setReducedMotion') {
        throw controlError('CONTROL_NOT_ALLOWED', `Command ${String(command)} is not allowed in ${this.mode}`);
      }
      let result;
      if (command === 'play') result = await this.controller.play();
      else if (command === 'pause') result = this.controller.pause();
      else if (command === 'restart') result = await this.controller.restart();
      else if (command === 'setPlaybackSpeed') result = await this.controller.setSpeed(Number(value));
      else if (command === 'setPlaybackThickness') result = await this.controller.setThickness(Number(value));
      else if (command === 'setDrawingEnabled') {
        this.allowDrawing = !!value;
        if (typeof this.painter.setManualPaintingEnabled === 'function') {
          result = this.painter.setManualPaintingEnabled(this.allowDrawing);
        } else {
          this.painter.manualPaintingEnabled = this.allowDrawing;
          result = true;
        }
      }
      else if (command === 'setPaintColor') {
        if (!this.palette.includes(value)) {
          throw controlError('PAINT_COLOR_NOT_ALLOWED', 'Paint color is not in the session palette', { value });
        }
        result = this.painter.setPaintColor(value.startsWith('#') ? hexToPaintHsva(value) : value);
      }
      else if (command === 'setPaintSize') result = this.painter.setPaintSize(Number(value));
      else if (command === 'clearPaint') result = await this.painter.clear();
      else if (command === 'setReducedMotion') {
        this.reducedMotion = !!value;
        if (typeof document !== 'undefined') {
          document.documentElement.toggleAttribute('data-reduced-motion', this.reducedMotion);
        }
        if (this.mode === 'fluid-play' && this.reducedMotion) await this.controller.setSpeed(1);
        result = this.reducedMotion;
      }
      this._emit();
      return { accepted: true, transferId, result, state: this.getState() };
    }

    getState() {
      const view = this.controller._viewModel();
      return {
        mode: this.mode,
        transferId: this.transferId,
        status: view.state,
        playbackSpeed: view.speed,
        playbackThickness: view.thickness,
        allowDrawing: this.allowDrawing,
        autoplay: this.autoplay,
        targetDuration: view.targetDuration ?? 0,
        elapsed: view.elapsed ?? 0,
        estimatedRemaining: view.estimatedRemaining ?? 0,
        canPlay: ['ready', 'paused', 'completed', 'completed-with-gaps'].includes(view.state),
        canPause: view.state === 'playing',
        canRestart: !!this.controller.model,
        error: view.error ? {
          code: view.error.code || view.error.name || 'PLAYER_ERROR',
          message: String(view.error.message || view.error),
        } : null,
        progress: { ...view.progress },
        paintSize: this.painter.brushScale,
        paintColor: this.painter.adhocPaintColor || [...this.painter.brushColorHSVA],
        palette: [...this.palette],
        reducedMotion: this.reducedMotion,
      };
    }

    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    _emit() { const state = this.getState(); this.listeners.forEach((listener) => { try { listener(state); } catch (_) {} }); }
    dispose() {
      if (typeof this.painter.setManualPaintingEnabled === 'function') this.painter.setManualPaintingEnabled(true);
      else this.painter.manualPaintingEnabled = true;
      if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-reduced-motion');
      this.unsubscribeController?.();
      this.listeners.clear();
    }
  }

  root.FLUID_PRODUCT_MODES = MODES;
  root.FluidControlApi = FluidControlApi;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FluidControlApi, FLUID_PRODUCT_MODES: MODES, hexToPaintHsva };
  }
})(typeof window !== 'undefined' ? window : globalThis);
