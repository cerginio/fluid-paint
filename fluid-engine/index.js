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
   */
  constructor(wgl, shaderSources, { resolutionWidth, resolutionHeight, maxBristleCount }) {
    this.wgl = wgl;

    this.simulator = new Simulator(wgl, shaderSources, resolutionWidth, resolutionHeight);
    this.brush = new Brush(wgl, shaderSources, maxBristleCount);
    this.renderer = new PaintingRenderer(wgl, shaderSources);

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
    this.brush.update(x, y, height, scale);
  }

  /** Settle the bristles at a position, before a stroke begins. */
  initializeBrush(x, y, height, scale) {
    this.brush.initialize(x, y, height, scale);
  }

  /**
   * Deposit paint where the bristles cross the painting.
   *
   * @param {Rectangle} brushRectangle  the painting, in the brush's own space
   * @param {number[]}  color           RYB or RGB triple plus alpha
   */
  splat(brushRectangle, { zThreshold, color, radius, velocityScale }) {
    this.simulator.splat(this.brush, zThreshold, brushRectangle, color, radius, velocityScale);
  }

  /** Advance the fluid one step. Returns whether anything actually moved. */
  frame() {
    return this.simulator.simulate();
  }

  // --- Painting geometry ------------------------------------------------

  /** Re-allocate at a new simulation resolution, discarding nothing. */
  changeResolution(width, height) {
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
    return {
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
