'use strict';

/*
 * Phase 9 — a minimal second host for FluidEngine.
 *
 * The plan's rule for this phase: "If this host needs anything the API does not
 * expose, the API is wrong — and that is the point of building it."
 *
 * So this file is written the way an outside integrator would write it: using
 * only what `fluid-engine/index.js` documents as public, never reaching for
 * `engine.simulator` / `engine.brush` / `engine.renderer`, and never borrowing a
 * constant out of `paint-setup.js`. Where that turned out to be impossible, the
 * workaround is marked **API FINDING** at the line that forced it, and the same
 * findings are collected in docs/API-FINDINGS.md.
 *
 * The grep that proves the first half of that claim, same as Phase 5's:
 *
 *     grep -n "engine\.\(simulator\|brush\|renderer\)" examples/minimal/minimal.js
 *
 * must print nothing.
 */

// ---------------------------------------------------------------------------
// Host constants
//
// Everything the engine needs from the host, defined here rather than imported
// from paint-setup.js. That is the point: a second host has no paint-setup.js,
// and anything it cannot supply on its own is a gap in the engine's surface.
// ---------------------------------------------------------------------------

// The painting's inset from the canvas edge, in device pixels.
const PADDING = 24;

// Simulation texels per painting pixel. The main app calls this "quality" and
// offers three; one fixed middle value is enough to host the engine.
const RESOLUTION_SCALE = 1.0;

// Bristles. MAX is what the engine allocates for; the live count can be raised
// to it later through setBrush() without re-allocating.
const MAX_BRISTLE_COUNT = 100;
const BRISTLE_COUNT = 50;

/*
 * Brush hover height, for placing the brush when NOT painting (hover preview).
 *
 * Z_THRESHOLD, SPLAT_RADIUS and SPLAT_VELOCITY_SCALE used to live here too,
 * copied from the main app. Phase 9a moved them into the engine's named stroke
 * API, which is where they belonged: they are tuned together -- raise the
 * height without raising the threshold and the bristles never reach the paper
 * -- and every host that copied them was one edit away from a brush that either
 * floods or lays nothing.
 */
const BRUSH_HEIGHT = 2.0;

// Deposited alpha, at this bristle count. The main app interpolates between a
// thin-brush and a thick-brush curve; one fixed midpoint is enough here.
const SPLAT_ALPHA = 0.04;

/*
 * Where this host serves the engine's shaders from. The engine says WHICH files
 * it needs (FluidEngine.SHADER_FILES); the host says WHERE they are and does the
 * fetching, because a host may bundle, inline, or serve them from anywhere.
 *
 * **API FINDINGS 1 and 2, now closed.** Writing this host originally required
 * two things the engine did not publish, both recorded in docs/API-FINDINGS.md:
 *
 *   1. The colour model enum. `renderToTexture({ colorModel })` was an engine
 *      parameter whose only public name lived in the APP's paint-setup.js, and
 *      whose value the renderer compared against a private literal. A host had
 *      to pass a bare number -- and getting it wrong is silent, because every
 *      value that is not exactly RGB falls through to RYB.
 *   2. The shader manifest. The list of the engine's own nineteen shader files
 *      lived in the app's common.js, so a host had to carry an inventory of
 *      engine internals that goes stale whenever a pass is added.
 *
 * Both are now `FluidEngine.COLOR_MODEL` and `FluidEngine.SHADER_FILES`, which
 * is why this file no longer declares either. That is the phase working as
 * intended: the host found the gaps, and the engine grew.
 */
const ENGINE_SHADER_BASE = '../../fluid-engine/';

/*
 * HSV -> RYB, at the boundary and nowhere else.
 *
 * §3b of the plan: the simulation's colour space is David Li's subtractive RYB
 * pigment cube, NOT RGB. Handing an RGB triple to splat() produces mixing that
 * looks plausible and is wrong -- yellow over blue comes out grey instead of
 * green -- with no error at any layer.
 *
 * Ten lines copied from common.js rather than pulling common.js in, because
 * this is the one conversion a host genuinely owns: it decides what colour the
 * user picked, and the engine decides what pigment does. The conversion is the
 * handshake between those two.
 */
function hsvToRyb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const c = v * s;
  const hDash = h * 6;
  const x = c * (1 - Math.abs((hDash % 2) - 1));
  const i = Math.floor(hDash);
  const r = [c, x, 0, 0, x, c][i];
  const g = [x, c, c, x, 0, 0][i];
  const b = [0, 0, x, c, c, x][i];
  const m = v - c;
  return [r + m, g + m, b + m];
}

// ---------------------------------------------------------------------------
// The host
// ---------------------------------------------------------------------------

class MinimalHost {
  constructor(canvas, wgl, container, shaderSources) {
    this.canvas = canvas;
    this.wgl = wgl;
    this.container = container;

    // Host state. None of this is the engine's: where the painting sits, how
    // big the brush is, what colour is selected, whether a pointer is down.
    this.hue = 0.6;
    this.brushScale = 50;
    this.painting = false;
    this.brushPlaced = false;
    this.brushX = 0;
    this.brushY = 0;
    this.needsRedraw = true;

    // Sized before the engine, because the engine's simulation resolution is
    // derived from it.
    this._resizeCanvas();
    this.paintingRectangle = new Rectangle(
      PADDING,
      PADDING,
      Math.max(1, canvas.width - PADDING * 2),
      Math.max(1, canvas.height - PADDING * 2)
    );

    this.engine = new FluidEngine(wgl, shaderSources, {
      resolutionWidth: this._resolutionWidth(),
      resolutionHeight: this._resolutionHeight(),
      maxBristleCount: MAX_BRISTLE_COUNT,
    });

    this.engine.setBrush({ bristleCount: BRISTLE_COUNT });

    /*
     * The capability the engine is honest about, and the one a host must act
     * on. A device that cannot alpha-blend into a float target at any precision
     * shows a perfectly healthy canvas and deposits nothing -- the iPhone 14
     * bug. Asking here means this host fails loudly instead of looking fine.
     */
    if (!this.engine.capabilities.canDepositPaint) {
      throw new Error(
        'This device cannot blend into floating point textures, so no stroke ' +
        'could deposit paint.'
      );
    }

    /*
     * The render target the painting is composited into, and the framebuffer it
     * is rendered through. Both are the HOST's, on purpose: renderToTexture()
     * takes them as arguments rather than caching them, which is what lets one
     * renderer serve the screen, the save path, and this page. See
     * fluid-engine/renderer.js.
     */
    this.framebuffer = wgl.createFramebuffer();
    this.canvasTexture = null;
    this._buildCanvasTexture();

    this._bindControls();
    this._bindPointer();
    this._bindResize();

    this._start();
  }

  // --- Sizing -----------------------------------------------------------

  /*
   * Size the backing store from the CONTAINER's CSS box, times DPR.
   *
   * This host does not use viewport.js -- that is app code, and the point of
   * this page is to run without it. But it does honour the two rules Phase 2
   * and Phase 7 established, because an example is read as a template:
   *
   *   - measure the CONTAINER, never window.innerWidth. A canvas measured
   *     against the window is wrong the moment anything else is on the page.
   *   - clamp devicePixelRatio. Simulation cost scales with its SQUARE, so an
   *     uncapped DPR-3 phone asks for 9x the fill rate.
   */
  _resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));

    if (this.canvas.width === width && this.canvas.height === height) return false;

    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  _resolutionWidth() {
    return Math.ceil(this.paintingRectangle.width * RESOLUTION_SCALE);
  }

  _resolutionHeight() {
    return Math.ceil(this.paintingRectangle.height * RESOLUTION_SCALE);
  }

  _buildCanvasTexture() {
    const wgl = this.wgl;

    // Release the old one first. Skipping this leaks a full canvas-sized RGBA
    // texture per resize, which on a phone is once per rotation.
    if (this.canvasTexture !== null) wgl.deleteTexture(this.canvasTexture);

    this.canvasTexture = wgl.buildTexture(
      wgl.RGBA,
      wgl.UNSIGNED_BYTE,
      this.canvas.width,
      this.canvas.height,
      null,
      wgl.CLAMP_TO_EDGE,
      wgl.CLAMP_TO_EDGE,
      wgl.LINEAR,
      wgl.LINEAR
    );
  }

  _bindResize() {
    /*
     * ResizeObserver on the container, not a window 'resize' listener: the
     * container's box can change without the window's doing so (the control bar
     * wrapping to two lines is enough), and a window listener misses that.
     */
    const observer = new ResizeObserver(() => this._onResize());
    observer.observe(this.container);
  }

  _onResize() {
    if (!this._resizeCanvas()) return;

    this._buildCanvasTexture();

    /*
     * The painting rectangle is HOST state, so keeping it inside the new canvas
     * is the host's job. This host takes the simplest defensible policy: keep
     * the painting's SIZE and clamp its position, so a resize never destroys
     * paint. (Shrinking the rectangle would -- that is UX finding 1 in the
     * handoff, and it is not a mistake worth repeating in an example.)
     */
    this.paintingRectangle.left = Utilities.clamp(
      this.paintingRectangle.left,
      -this.paintingRectangle.width,
      this.canvas.width
    );
    this.paintingRectangle.bottom = Utilities.clamp(
      this.paintingRectangle.bottom,
      -this.paintingRectangle.height,
      this.canvas.height
    );

    this.needsRedraw = true;
  }

  // --- Controls ---------------------------------------------------------

  _bindControls() {
    const hue = document.getElementById('hue');
    hue.value = String(this.hue);
    hue.addEventListener('input', () => { this.hue = parseFloat(hue.value); });

    const size = document.getElementById('size');
    size.value = String(this.brushScale);
    size.addEventListener('input', () => { this.brushScale = parseFloat(size.value); });

    /*
     * The fluidity slider initialises FROM the engine rather than from a
     * hardcoded default. `engine.fluidity` exists for exactly this: a host that
     * hardcoded its own starting value would show a control that disagrees with
     * the simulation until the user first touches it.
     */
    const fluidity = document.getElementById('fluidity');
    fluidity.value = String(this.engine.fluidity);
    fluidity.addEventListener('input', () => {
      this.engine.setSimulation({ fluidity: parseFloat(fluidity.value) });
    });

    document.getElementById('clear').addEventListener('click', () => {
      this.engine.clear();
      this.needsRedraw = true;
    });
  }

  // --- Input ------------------------------------------------------------

  /*
   * Raw PointerEvents, not the vendored dispatcher.
   *
   * The dispatcher is app UI (gestures, coalescing, pinch); a host that only
   * wants a single-pointer stroke should not need it, and this page is the check
   * that it does not. What the host DOES have to get right is the coordinate
   * conversion, and it is two facts, both easy to get silently wrong:
   *
   *   1. Pointer coordinates are CSS pixels; the engine works in the same space
   *      as the painting rectangle, which is the canvas BACKING STORE. So both
   *      axes are scaled by width/clientWidth.
   *   2. The engine's Y is UP; the DOM's Y is DOWN. The flip is a subtraction
   *      from the height, and it must happen AFTER the scale.
   *
   * Getting either wrong paints in the wrong place, which at least is visible.
   */
  _toEngineSpace(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: this.canvas.height - (clientY - rect.top) * scaleY,
    };
  }

  _bindPointer() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);

      const p = this._toEngineSpace(event.clientX, event.clientY);
      this.brushX = p.x;
      this.brushY = p.y;

      // A live press deposits once; the clock drives subsequent paint.
      const color = hsvToRyb(this.hue, 1, 1);
      this.engine.beginStroke({
        timing: 'live',
        x: this.brushX,
        y: this.brushY,
        brushSize: this.brushScale,
        paintingRectangle: this.paintingRectangle,
        // The engine takes pigment coordinates, never display RGB: conversion
        // is the host's job and an RGB triple is rejected rather than mixed.
        color: {
          space: 'pigment',
          channels: [color[0], color[1], color[2]],
          alpha: SPLAT_ALPHA,
        },
        resolutionScale: RESOLUTION_SCALE,
      });
      this.brushPlaced = true;
      this.painting = true;
      this.needsRedraw = true;
    });

    canvas.addEventListener('pointermove', (event) => {
      const p = this._toEngineSpace(event.clientX, event.clientY);
      this.brushX = p.x;
      this.brushY = p.y;

      if (this.engine.strokeActive) {
        // Input stays cheap; advance() owns the physical clock.
        this.engine.strokeTo({ x: this.brushX, y: this.brushY });
        this.needsRedraw = true;
        return;
      }

      // Hover moves the brush but does not paint, so the bristles are already
      // where the stroke will start when the user does press.
      if (!this.brushPlaced) {
        this.engine.initializeBrush(
          this.brushX,
          this.brushY,
          BRUSH_HEIGHT * this.brushScale,
          this.brushScale
        );
        this.brushPlaced = true;
      }
    });

    const end = (event) => {
      if (this.engine.strokeActive && event.type === 'pointerup') {
        const p = this._toEngineSpace(event.clientX, event.clientY);
        this.engine.strokeTo({ x: p.x, y: p.y });
      }
      // endStroke() flushes the last pointer position, so the stroke ends where
      // the finger did rather than at the last resampled point.
      if (this.engine.strokeActive) {
        this.engine.endStroke();
        this.needsRedraw = true;
      }
      this.painting = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  // --- The loop ---------------------------------------------------------

  _start() {
    document.addEventListener('visibilitychange', () => this.engine.resetClock(performance.now() / 1000));
    const loop = () => {
      if (!document.hidden) this._update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _update() {
    const result = this.engine.advance(performance.now() / 1000,
      this.brushPlaced ? { x: this.brushX, y: this.brushY,
        height: BRUSH_HEIGHT * this.brushScale, scale: this.brushScale } : undefined);
    if (result.simulationUpdated) this.needsRedraw = true;

    const clipped = this.paintingRectangle
      .clone()
      .intersectRectangle(new Rectangle(0, 0, this.canvas.width, this.canvas.height));

    if (this.needsRedraw) {
      this.engine.renderToTexture({
        framebuffer: this.framebuffer,
        targetTexture: this.canvasTexture,
        paintingRectangle: this.paintingRectangle,
        clippedRectangle: clipped,
        targetWidth: this.canvas.width,
        targetHeight: this.canvas.height,
        resolutionScale: RESOLUTION_SCALE,
        colorModel: FluidEngine.COLOR_MODEL.RYB,
        resizing: false,
      });
      this.needsRedraw = false;
    }

    /*
     * present() every frame, even when nothing was redrawn. The painting lives
     * in a host texture; the default framebuffer is not persistent, so skipping
     * the blit on a still frame flickers. (The main app has chrome drawn over
     * this blit; this host has none, which is why the split is easier to see
     * here: the redraw is conditional, the blit never is.)
     */
    this.engine.present(this.canvasTexture, this.canvas.width, this.canvas.height);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function setStatus(text, isError) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-cell');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const wgl = WrappedGL.create(canvas);

  if (wgl === null) {
    setStatus('This browser does not support WebGL.', true);
    return;
  }

  /*
   * The startup gate, in the order that matters. `hasFloatTextureSupport()`
   * asks only whether a float target can be RENDERED into; splat() additionally
   * needs to alpha-BLEND into one, and those are different questions -- the gap
   * between them is the entire iPhone 14 bug. `canBlendIntoTexture()` performs
   * the exact blend and reads the result back.
   *
   * Half-float is asked for via getHalfFloatType(), NOT by requesting the
   * OES_texture_half_float extension: on WebGL 2 half-float is core and the
   * extension is generally not exposed, so the extension check returns null on
   * hardware that supports it perfectly well.
   */
  if (!wgl.hasFloatTextureSupport()) {
    setStatus('This browser does not support floating point textures.', true);
    return;
  }

  const halfFloatType = wgl.getHalfFloatType();
  const canBlend = wgl.canBlendIntoTexture(wgl.FLOAT) ||
    (halfFloatType !== null && wgl.canBlendIntoTexture(halfFloatType));

  if (!canBlend) {
    setStatus('This browser cannot blend into floating point textures.', true);
    return;
  }

  if (wgl.isWebGL2) {
    wgl.getExtension('EXT_color_buffer_float');
  } else {
    wgl.getExtension('OES_texture_float');
  }

  WrappedGL.loadTextFiles(FluidEngine.SHADER_FILES, (shaderSources) => {
    try {
      const host = new MinimalHost(canvas, wgl, container, shaderSources);
      window.__minimalHost = host;   // handle for debug/phase9-probe.js

      const caps = host.engine.capabilities;
      setStatus(
        `WebGL ${caps.webglVersion} · ` +
        `${host.engine.resolutionWidth}x${host.engine.resolutionHeight} · ` +
        `${host.engine.bristleCount} bristles`
      );
    } catch (err) {
      setStatus(err.message, true);
      console.error(err);
    }
  }, ENGINE_SHADER_BASE);
});
