(function (root) {
  'use strict';

  const VERSION = 1;
  const FEATURE_IDS = Object.freeze([
    'color-picker',
    'brush-size',
    'colors-options',
    'brush-options',
    'player',
    'file-bg',
    'file-play',
    'state-bake',
  ]);
  const PRESETS = Object.freeze({
    'draw-min': Object.freeze(['color-picker', 'brush-size']),
    'draw-full': Object.freeze(['color-picker', 'brush-size', 'colors-options', 'brush-options']),
  });
  const FULL_FEATURE_IDS = Object.freeze([...FEATURE_IDS]);

  function uiError(code, message, details = {}) {
    return Object.assign(new Error(message), { code, details });
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizeFeatureList(features, required) {
    if (!Array.isArray(features) || (required && features.length === 0)) {
      throw uiError('UI_FEATURES_REQUIRED', 'features must be a non-empty array');
    }
    const unique = [...new Set(features)];
    const unknown = unique.filter((feature) => !FEATURE_IDS.includes(feature));
    if (unknown.length) {
      throw uiError('UNKNOWN_UI_FEATURE', `Unknown Fluid UI feature: ${unknown[0]}`, { feature: unknown[0] });
    }
    return FEATURE_IDS.filter((feature) => unique.includes(feature));
  }

  function resolveFluidUiConfig(input) {
    const config = input === undefined || input === null ? { mode: 'full' } : clone(input);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw uiError('INVALID_UI_CONFIG', 'Fluid UI configuration must be an object');
    }
    const version = config.version === undefined ? VERSION : config.version;
    if (version !== VERSION) throw uiError('UNSUPPORTED_UI_API_VERSION', `Unsupported Fluid UI API version: ${version}`);
    if (!['empty', 'full', 'features', 'preset'].includes(config.mode)) {
      throw uiError('UNKNOWN_UI_MODE', `Unknown Fluid UI mode: ${String(config.mode)}`);
    }

    let normalized;
    let resolvedFeatures;
    if (config.mode === 'empty' || config.mode === 'full') {
      if ('preset' in config) throw uiError('UI_PRESET_NOT_ALLOWED', `${config.mode} mode does not accept a preset`);
      if ('features' in config) throw uiError('UI_FEATURES_NOT_ALLOWED', `${config.mode} mode does not accept features`);
      normalized = { version, mode: config.mode };
      resolvedFeatures = config.mode === 'full' ? [...FULL_FEATURE_IDS] : [];
    } else if (config.mode === 'features') {
      if ('preset' in config) throw uiError('UI_PRESET_NOT_ALLOWED', 'features mode does not accept a preset');
      resolvedFeatures = normalizeFeatureList(config.features, true);
      normalized = { version, mode: 'features', features: resolvedFeatures };
    } else {
      if (Array.isArray(config.preset)) throw uiError('MULTIPLE_UI_PRESETS', 'Exactly one Fluid UI preset may be selected');
      if (typeof config.preset !== 'string' || !config.preset) {
        throw uiError('UI_PRESET_REQUIRED', 'preset mode requires one preset');
      }
      if (!Object.prototype.hasOwnProperty.call(PRESETS, config.preset)) {
        throw uiError('UNKNOWN_UI_PRESET', `Unknown Fluid UI preset: ${config.preset}`, { preset: config.preset });
      }
      const extensions = config.features === undefined ? [] : normalizeFeatureList(config.features, false);
      resolvedFeatures = FEATURE_IDS.filter((feature) => PRESETS[config.preset].includes(feature) || extensions.includes(feature));
      normalized = { version, mode: 'preset', preset: config.preset };
      if (extensions.length) normalized.features = extensions;
    }
    return { config: normalized, resolvedFeatures };
  }

  function parseFluidUiConfig(search) {
    const params = search instanceof URLSearchParams
      ? search
      : new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const hasConfig = ['uiMode', 'uiPreset', 'uiFeatures'].some((key) => params.has(key));
    if (!hasConfig) return { mode: 'full' };
    const modes = params.getAll('uiMode');
    if (!modes.length) throw uiError('UI_MODE_REQUIRED', 'uiMode is required when UI options are present');
    if (modes.length > 1) throw uiError('MULTIPLE_UI_MODES', 'Exactly one Fluid UI mode may be selected');
    const mode = modes[0];
    const config = { mode };
    const presets = params.getAll('uiPreset');
    if (presets.length > 1) throw uiError('MULTIPLE_UI_PRESETS', 'Exactly one Fluid UI preset may be selected');
    if (presets.length) config.preset = presets[0];
    const features = params.getAll('uiFeatures')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    if (params.has('uiFeatures')) config.features = features;
    resolveFluidUiConfig(config);
    return config;
  }

  function setAvailable(element, available) {
    if (!element) return;
    element.hidden = !available;
    if ('inert' in element) element.inert = !available;
    if (available) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', 'true');
  }

  class FluidUiDomAdapter {
    constructor(documentRef) {
      this.document = documentRef;
      this.enabled = new Set();
      this.root = documentRef?.getElementById('ui') || null;
    }

    apply(features, config = { mode: 'full' }) {
      this.enabled = new Set(features);
      const has = (feature) => this.enabled.has(feature);
      this.document?.querySelectorAll('[data-fluid-ui-feature]').forEach((element) => {
        const alternatives = element.getAttribute('data-fluid-ui-feature').split(/\s+/).filter(Boolean);
        setAvailable(element, alternatives.some(has));
      });
      this.document?.querySelectorAll('[data-fluid-ui-full-only]').forEach((element) => {
        setAvailable(element, config.mode === 'full');
      });

      const fileVisible = has('file-bg') || has('file-play');
      const extensionVisible = fileVisible || has('player') || has('state-bake');
      setAvailable(this.document?.getElementById('story-file-tab'), fileVisible);
      setAvailable(this.document?.getElementById('story-file-page'), fileVisible);
      setAvailable(this.document?.getElementById('story-player-tab'), has('player'));
      setAvailable(this.document?.getElementById('story-player-page'), has('player'));
      setAvailable(this.document?.getElementById('bake-tab'), has('state-bake'));
      setAvailable(this.document?.getElementById('bake-page'), has('state-bake'));
      setAvailable(this.document?.getElementById('panel-extension-toggle'), extensionVisible);
      const extension = this.document?.getElementById('panel-extension');
      if (extension) {
        if ('inert' in extension) extension.inert = !extensionVisible;
        if (extensionVisible) extension.removeAttribute('aria-hidden');
        else {
          extension.hidden = true;
          extension.setAttribute('aria-hidden', 'true');
        }
      }

      const input = this.document?.getElementById('story-file-input');
      if (input) {
        input.accept = has('file-bg') && has('file-play')
          ? '.json,.png,application/json,image/png'
          : has('file-bg') ? '.png,image/png' : '.json,application/json';
      }
      setAvailable(this.document?.querySelector('.panel-column-controls'),
        has('brush-size') || has('brush-options') || has('colors-options') || has('state-bake'));
      setAvailable(this.document?.querySelector('.panel-column-color'), has('color-picker'));
      setAvailable(this.document?.getElementById('panel-body'),
        has('color-picker') || has('brush-size') || has('brush-options') || has('colors-options') || has('state-bake'));
      setAvailable(this.document?.getElementById('ui'), features.length > 0);
      this.root?.setAttribute('data-fluid-ui-features', features.join(' '));
      if (this.document?.dispatchEvent && typeof CustomEvent === 'function') {
        this.document.dispatchEvent(new CustomEvent('fluid-ui-layout-changed', { detail: { features: [...features] } }));
      }
    }
  }

  class FluidUiPresetApi {
    constructor({ initialConfig, adapter } = {}) {
      this.adapter = adapter || null;
      this.listeners = new Set();
      this.disposed = false;
      this.queue = Promise.resolve();
      const resolved = resolveFluidUiConfig(initialConfig);
      this.state = { version: VERSION, revision: 0, ...resolved };
      this.adapter?.apply(this.state.resolvedFeatures, this.state.config);
    }

    configure(config) {
      const run = async () => {
        if (this.disposed) throw uiError('UI_API_DISPOSED', 'Fluid UI API has been disposed');
        if (this.state.degraded) throw uiError('UI_ROLLBACK_FAILED', 'Fluid UI is degraded; reload is required', clone(this.state.degraded));
        const next = resolveFluidUiConfig(config);
        if (JSON.stringify(next.config) === JSON.stringify(this.state.config)) {
          return this.getState();
        }
        const previous = this.getState();
        const domChanged = JSON.stringify(next.resolvedFeatures) !== JSON.stringify(previous.resolvedFeatures) ||
          (next.config.mode === 'full') !== (previous.config.mode === 'full');
        if (domChanged) {
          try {
            const result = this.adapter?.apply(next.resolvedFeatures, next.config);
            if (result && typeof result.then === 'function') {
              throw uiError('UI_APPLY_FAILED', 'Fluid UI adapters must be synchronous');
            }
          } catch (cause) {
            try {
              const rollback = this.adapter?.apply(previous.resolvedFeatures, previous.config);
              if (rollback && typeof rollback.then === 'function') throw new Error('Fluid UI rollback must be synchronous');
            } catch (rollbackError) {
              this.state = {
                ...previous,
                degraded: {
                  applyError: { code: cause?.code || 'UI_APPLY_FAILED', message: String(cause?.message || cause) },
                  rollbackError: { code: rollbackError?.code || 'UI_ROLLBACK_FAILED', message: String(rollbackError?.message || rollbackError) },
                },
              };
              throw uiError('UI_ROLLBACK_FAILED', 'Fluid UI apply and rollback both failed', clone(this.state.degraded));
            }
            throw uiError('UI_APPLY_FAILED', 'Fluid UI layout could not be applied', { cause: String(cause?.message || cause) });
          }
        }
        if (this.disposed) {
          if (domChanged) this.adapter?.apply(previous.resolvedFeatures, previous.config);
          throw uiError('UI_API_DISPOSED', 'Fluid UI API was disposed before the state commit');
        }
        this.state = { version: VERSION, revision: previous.revision + 1, ...next };
        const snapshot = this.getState();
        for (const listener of this.listeners) {
          try { listener(clone(snapshot)); } catch (_) { /* listeners are isolated */ }
        }
        return snapshot;
      };
      this.queue = this.queue.then(run, run);
      return this.queue;
    }

    getConfig() { return clone(this.state.config); }
    getState() { return clone(this.state); }
    getResolvedFeatures() { return [...this.state.resolvedFeatures]; }
    hasFeature(feature) { return this.state.resolvedFeatures.includes(feature); }
    subscribe(listener) { this.listeners.add(listener); let active = true; return () => { if (active) this.listeners.delete(listener); active = false; }; }
    dispose() { this.disposed = true; this.listeners.clear(); }
  }

  function createFluidUiPresetApi(options = {}) {
    return new FluidUiPresetApi(options);
  }

  Object.assign(root, {
    FLUID_UI_API_VERSION: VERSION,
    FLUID_UI_FEATURE_IDS: FEATURE_IDS,
    FLUID_UI_PRESETS: PRESETS,
    FLUID_UI_FULL_FEATURE_IDS: FULL_FEATURE_IDS,
    FluidUiDomAdapter,
    FluidUiPresetApi,
    createFluidUiPresetApi,
    parseFluidUiConfig,
    resolveFluidUiConfig,
  });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VERSION, FEATURE_IDS, PRESETS, FULL_FEATURE_IDS, FluidUiPresetApi, createFluidUiPresetApi, parseFluidUiConfig, resolveFluidUiConfig };
  }
})(typeof window !== 'undefined' ? window : globalThis);
