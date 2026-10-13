'use strict';

(async () => {
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('canvas');
  const status = document.getElementById('status');
  const report = document.getElementById('report');
  const button = document.getElementById('run');
  try {
    const wgl = WrappedGL.create(canvas, { alpha: false, preserveDrawingBuffer: true },
      (gl) => installGpuClamp(gl, params.get('gpu') || 'desktop'));
    if (!wgl || !wgl.hasFloatTextureSupport()) throw new Error('Float WebGL unavailable');
    const sources = {};
    await Promise.all(FluidEngine.SHADER_FILES.map(async (file) => {
      const response = await fetch('../fluid-engine/' + file);
      if (!response.ok) throw new Error(file + ': HTTP ' + response.status);
      sources[file] = await response.text();
    }));
    const engine = new FluidEngine(wgl, sources, {
      resolutionWidth: 128, resolutionHeight: 96, maxBristleCount: 12, random: () => .4,
    });
    engine.setBrush({ bristleCount: 12 });
    engine.setSimulation({ fluidity: .9 });
    if (!engine.capabilities.canDepositPaint) throw new Error('GPU cannot deposit paint');
    const rect = new Rectangle(0, 0, 128, 96);
    const exportPixels = () => engine.exportPixels({ width: 128, height: 96,
      resolutionScale: 1, colorModel: FluidEngine.COLOR_MODEL.RGB });
    const delta = (a, b) => {
      if (a.length !== b.length) throw new Error('Pixel dimensions differ');
      let max = 0;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Nonfinite pixel');
        max = Math.max(max, Math.abs(a[i] - b[i]));
      }
      return max;
    };
    const show = () => {
      const pixels = exportPixels();
      const target = wgl.buildTexture(wgl.RGBA, wgl.UNSIGNED_BYTE, 128, 96, null,
        wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);
      const framebuffer = wgl.createFramebuffer();
      engine.renderToTexture({ framebuffer, targetTexture: target, paintingRectangle: rect,
        clippedRectangle: rect, targetWidth: 128, targetHeight: 96, resolutionScale: 1,
        colorModel: FluidEngine.COLOR_MODEL.RGB, resizing: false });
      engine.present(target, 128, 96);
      wgl.deleteFramebuffer(framebuffer);
      wgl.deleteTexture(target);
      return pixels;
    };
    const palette = document.getElementById('palette');
    let paletteMode = palette.value;
    const samples = [];
    for (const mode of ['natural', 'digital']) {
      for (const hsv of [[0, 1, 1], [1 / 3, 1, 1], [2 / 3, 1, 1], [.13, .55, .72], [.8, .25, .5], [0, 0, 1]]) {
        samples.push({ name: mode + ' ' + hsv.join(','), rgb: PaintColorAdapter.paletteRgb(...hsv, mode) });
      }
    }
    samples.push({ name: 'White', rgb: [1, 1, 1] }, { name: 'Black', rgb: [0, 0, 0] });
    for (const hex of ['#123456', '#ff0080', '#00ff80']) {
      samples.push({ name: hex, rgb: PaintColorAdapter.hexRgb(hex) });
    }
    document.getElementById('samples').replaceChildren(...samples.map((sample) => {
      const span = document.createElement('span');
      span.className = 'sample'; span.style.background = cssRgb(sample.rgb);
      span.textContent = sample.name; span.style.color = sample.rgb.reduce((a, b) => a + b) > 1.5 ? '#000' : '#fff';
      return span;
    }));
    // Плоский матеріал: незалежний розрахунок штатного diffuse/specular із painting.frag.
    const nDotL = 1 / Math.sqrt(2);
    const nDotH = Math.sqrt((1 + nDotL) / 2);
    const a2 = Math.pow(.075, 4);
    const D = a2 / (Math.PI * Math.pow(nDotH * nDotH * (a2 - 1) + 1, 2));
    const G = 1 / ((nDotL + Math.sqrt(a2 + (1 - a2) * nDotL * nDotL)) * 2);
    const F = .05 + .95 * Math.pow(1 - nDotH, 5);
    const diffuse = nDotL * .15 + .85;
    const specular = D * G * F * .5;
    const requireCheck = (value, message) => { if (!value) throw new Error(message); };
    const selectPalette = (mode) => {
      palette.value = mode;
      palette.dispatchEvent(new Event('change'));
    };
    palette.addEventListener('change', () => {
      paletteMode = palette.value;
      show();
    });
    const run = () => {
      button.disabled = true;
      window.__probeResult = null;
      try {
        const decode = [];
        for (const sample of samples) {
          const channels = PaintColorAdapter.encodeRgb(sample.rgb);
          // Fixture-only діагностичний доступ: заливка відомого матеріалу без bristle/lighting у кольорі.
          const framebuffer = wgl.createFramebuffer();
          wgl.framebufferTexture2D(framebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0,
            wgl.TEXTURE_2D, engine.simulator.paintTexture, 0);
          wgl.clear(wgl.createClearState().bindFramebuffer(framebuffer)
            .clearColor(...channels, .5), wgl.COLOR_BUFFER_BIT);
          wgl.deleteFramebuffer(framebuffer);
          const pixels = exportPixels();
          const expected = sample.rgb.map((c) => Math.round(Math.max(0, Math.min(1, c * diffuse + specular)) * 255));
          let maxDelta = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            for (let c = 0; c < 3; c++) maxDelta = Math.max(maxDelta, Math.abs(pixels[i + c] - expected[c]));
            requireCheck(pixels[i + 3] === 255, 'Export alpha not opaque');
          }
          requireCheck(maxDelta <= 1, sample.name + ': decode delta ' + maxDelta);
          decode.push({ name: sample.name, rgb: sample.rgb, expected, maxDelta });
        }
        const rgbControl = exportPixels();
        const rybControl = engine.exportPixels({ width: 128, height: 96, resolutionScale: 1,
          colorModel: FluidEngine.COLOR_MODEL.RYB });
        const rendererNegativeControlDelta = delta(rgbControl, rybControl);
        requireCheck(rendererNegativeControlDelta > 1, 'Fixture cannot distinguish RGB from legacy RYB');
        const strokeRun = (initial, switches, mixed) => {
          engine.simulator.clearPaintAndDynamics();
          engine.resetClock(0);
          selectPalette(initial);
          const rgb = PaintColorAdapter.paletteRgb(.13, .65, .8, paletteMode);
          engine.beginStroke({ timing: 'live', x: 25, y: 32, brushSize: 35,
            paintingRectangle: rect, color: PaintColorAdapter.strokeColor(rgb, .2) });
          let steps = 0;
          for (let tick = 1; tick <= 15; tick++) {
            engine.strokeTo({ x: 20 + tick * 6, y: 32 + tick });
            steps += engine.advance(tick / 60).steps;
          }
          engine.endStroke();
          if (mixed) {
            const next = initial === 'natural' ? 'digital' : 'natural';
            selectPalette(next);
            engine.beginStroke({ timing: 'live', x: 30, y: 58, brushSize: 35,
              paintingRectangle: rect, color: PaintColorAdapter.strokeColor(
                PaintColorAdapter.paletteRgb(.7, .6, .9, paletteMode), .3) });
            engine.strokeTo({ x: 96, y: 58 });
            steps += engine.advance(16 / 60).steps;
            engine.endStroke();
          }
          const startTick = mixed ? 17 : 16;
          // Відомий потік fixture забезпечує рух матеріалу незалежно від bristle-геометрії.
          const velocityFramebuffer = wgl.createFramebuffer();
          for (const texture of [engine.simulator.velocityTexture, engine.simulator.velocityTextureTemp]) {
            wgl.framebufferTexture2D(velocityFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0,
              wgl.TEXTURE_2D, texture, 0);
            wgl.clear(wgl.createClearState().bindFramebuffer(velocityFramebuffer)
              .clearColor(2, 1, 0, 0), wgl.COLOR_BUFFER_BIT);
          }
          wgl.deleteFramebuffer(velocityFramebuffer);
          const rawBefore = engine.readPaintTexture().pixels;
          requireCheck(wgl.gl.getError() === 0, 'WebGL error before active comparison');
          const before = exportPixels();
          if (switches) {
            selectPalette(paletteMode === 'natural' ? 'digital' : 'natural');
            selectPalette(initial);
          }
          const frozenRawDelta = delta(rawBefore, engine.readPaintTexture().pixels);
          const frozenExportDelta = delta(before, exportPixels());
          requireCheck(frozenRawDelta === 0 && frozenExportDelta === 0, 'Frozen palette switch changed material');
          for (let tick = startTick; tick <= 30; tick++) {
            if (switches) selectPalette(tick % 2 ? 'natural' : 'digital');
            steps += engine.advance(tick / 60).steps;
          }
          const raw = engine.readPaintTexture().pixels;
          let alpha = 0;
          for (let i = 3; i < raw.length; i += 4) alpha += raw[i];
          requireCheck(alpha > 0, 'Empty stroke');
          return { raw, pixels: exportPixels(), steps, alpha, frozenRawDelta, frozenExportDelta,
            activeMaterialDelta: delta(rawBefore, raw) };
        };
        const comparisons = [];
        for (const [initial, mixed] of [['natural', false], ['digital', false], ['natural', true]]) {
          const control = strokeRun(initial, false, mixed);
          const switched = strokeRun(initial, true, mixed);
          const rawDelta = delta(control.raw, switched.raw);
          const exportDelta = delta(control.pixels, switched.pixels);
          requireCheck(control.steps === switched.steps && rawDelta === 0 && exportDelta === 0,
            'Active deterministic palette comparison failed');
          requireCheck(switched.activeMaterialDelta > 0, 'Active simulation did not move: ' +
            JSON.stringify({ initial, mixed, alpha: switched.alpha, steps: switched.steps,
              splatAreas: engine.simulator.splatAreas.length, frame: engine.simulator.frameNumber }));
          comparisons.push({ initial, mixed, steps: switched.steps, alpha: switched.alpha,
            rawDelta, exportDelta, frozenRawDelta: switched.frozenRawDelta,
            frozenExportDelta: switched.frozenExportDelta, activeMaterialDelta: switched.activeMaterialDelta });
        }
        show();
        requireCheck(wgl.gl.getError() === 0, 'WebGL error');
        window.__probeResult = { pass: true, webgl: engine.capabilities.webglVersion,
          precision: engine.simulator.paintTexturePrecision, gpuProfile: params.get('gpu') || 'desktop',
          decodeToleranceBytes: 1, invarianceTolerance: 0, rendererNegativeControlDelta,
          fixtureVelocity: [2, 1], fluidity: .9, decode, comparisons };
        status.textContent = 'PASS'; report.textContent = JSON.stringify(window.__probeResult, null, 2);
      } catch (error) {
        status.textContent = 'FAIL'; report.textContent = error.stack;
        window.__probeResult = { pass: false, error: error.message };
      } finally { button.disabled = false; }
      return window.__probeResult;
    };
    window.__colorProbe = { engine, run, exportPixels, selectPalette };
    button.addEventListener('click', run);
    status.textContent = 'Готово до запуску';
  } catch (error) {
    status.textContent = 'FAIL'; report.textContent = error.stack;
    window.__probeResult = { pass: false, error: error.message };
  }
})();
