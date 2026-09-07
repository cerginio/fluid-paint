/*
 * Viewport — the single owner of every coordinate transform.
 *
 * Three coordinate spaces coexist in this app, and before this module none of
 * them was named in the code (FLUID-ENGINE-EXTRACTION-PLAN.md §2):
 *
 *   1. CSS pixels      what the DOM and pointer events speak. Y grows DOWN.
 *   2. Screen pixels   the canvas backing store, = CSS pixels * devicePixelRatio.
 *                      Y grows UP -- this is the GL convention the whole
 *                      renderer and all the UI hit-testing already use.
 *   3. Painting pixels `paintingRectangle`, the painting's rect in screen pixels.
 *   4. Simulation texels  painting pixels * resolutionScale.
 *
 * Everything that converts between them goes through here. The point is not
 * tidiness: it is that with one owner, the rest of the code cannot express a
 * coordinate bug, because it never sees two spaces at once.
 *
 * On the Y-flip. Pointer events arrive with Y growing downward; the renderer
 * and every hit test want Y growing upward. That flip was open-coded in four
 * places, and any new input path had to remember to repeat it -- forgetting is
 * silent, which is the worst kind of bug to leave lying around. Now it happens
 * exactly once, in cssToScreen().
 *
 * On devicePixelRatio. It was previously never read, anywhere. The backing
 * store was pinned to CSS pixels, so on a DPR-3 phone the painting was drawn at
 * a third of the device's real resolution -- soft -- and pointer coordinates
 * were only approximately right. Reading it is what makes the painting sharp,
 * and it is why this module exists rather than a handful of helper functions.
 */

class Viewport {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @param {number} [options.maxPixelRatio]  clamp for the device pixel ratio.
   *   The simulation cost scales with the square of this, so an uncapped DPR-4
   *   tablet would ask for 16x the fill rate of the old behaviour. 2 keeps the
   *   painting visibly sharp without that cliff.
   * @param {boolean} [options.pixelRatioEnabled]  when false the ratio is
   *   pinned to 1, reproducing the pre-Phase-2 behaviour exactly.
   */
  constructor(canvas, options) {
    const opts = options || {};

    this.canvas = canvas;
    this.maxPixelRatio = opts.maxPixelRatio !== undefined ? opts.maxPixelRatio : 2;
    this.pixelRatioEnabled = opts.pixelRatioEnabled !== undefined ? opts.pixelRatioEnabled : true;

    this.pixelRatio = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;

    this.resize();
  }

  /**
   * The ratio actually in force: the device's, clamped, or exactly 1 when
   * disabled. Kept as a method so the clamping rule lives in one place.
   */
  computePixelRatio() {
    if (!this.pixelRatioEnabled) return 1;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return Math.max(1, Math.min(this.maxPixelRatio, dpr));
  }

  /**
   * Size the canvas to the window. The backing store is CSS size * ratio; the
   * CSS size is pinned explicitly so the element still occupies the window
   * rather than growing to the backing store's size.
   *
   * @returns {boolean} whether anything actually changed
   */
  resize() {
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    const pixelRatio = this.computePixelRatio();

    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));

    const changed =
      this.canvas.width !== width ||
      this.canvas.height !== height ||
      this.pixelRatio !== pixelRatio;

    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.pixelRatio = pixelRatio;

    this.canvas.width = width;
    this.canvas.height = height;

    // Only assert the CSS size when it would otherwise be wrong. At ratio 1 the
    // element already lays out at its backing-store size, and writing the style
    // anyway would be a visible change to a path this phase is meant to leave
    // alone.
    if (pixelRatio !== 1) {
      this.canvas.style.width = cssWidth + 'px';
      this.canvas.style.height = cssHeight + 'px';
    }

    return changed;
  }

  /** Backing-store width, in screen pixels. */
  get width() {
    return this.canvas.width;
  }

  /** Backing-store height, in screen pixels. */
  get height() {
    return this.canvas.height;
  }

  // --- CSS <-> screen -------------------------------------------------------

  /**
   * A pointer event's position, in screen pixels with Y growing up.
   *
   * This is the ONLY place the Y-flip happens, and the only place the DPR is
   * applied to input. Every pointer handler goes through it.
   *
   * @param {PointerEvent|MouseEvent|Touch} event
   * @returns {{x: number, y: number}}
   */
  eventToScreen(event) {
    const rect = this.canvas.getBoundingClientRect();
    return this.cssToScreen(event.clientX - rect.left, event.clientY - rect.top);
  }

  /**
   * CSS pixels (Y down, from the top-left) to screen pixels (Y up, from the
   * bottom-left).
   */
  cssToScreen(x, y) {
    const ratio = this.pixelRatio;
    return { x: x * ratio, y: this.height - y * ratio };
  }

  /** The inverse of cssToScreen, for anything that has to hand a value back. */
  screenToCss(x, y) {
    const ratio = this.pixelRatio;
    return { x: x / ratio, y: (this.height - y) / ratio };
  }

  /**
   * A length in CSS pixels expressed in screen pixels. Use it for anything
   * authored in CSS units -- UI panel sizes, hit-test margins, line widths --
   * so those keep their apparent size instead of shrinking as the DPR rises.
   */
  cssLengthToScreen(length) {
    return length * this.pixelRatio;
  }

  // --- screen <-> painting --------------------------------------------------

  /**
   * Screen pixels to painting-relative pixels (origin at the painting's
   * bottom-left corner).
   *
   * @param {number} x
   * @param {number} y
   * @param {Rectangle} paintingRectangle
   */
  screenToPainting(x, y, paintingRectangle) {
    return { x: x - paintingRectangle.left, y: y - paintingRectangle.bottom };
  }

  /** Painting-relative pixels back to screen pixels. */
  paintingToScreen(x, y, paintingRectangle) {
    return { x: x + paintingRectangle.left, y: y + paintingRectangle.bottom };
  }

  // --- painting <-> simulation ----------------------------------------------

  /**
   * Painting-relative pixels to simulation texels.
   *
   * The simulation's resolution is the painting's size times resolutionScale,
   * so this is that scale -- expressed from the actual texture dimensions
   * rather than recomputed, so it cannot drift from what the simulator built.
   *
   * @param {number} x
   * @param {number} y
   * @param {Rectangle} paintingRectangle
   * @param {number} resolutionWidth
   * @param {number} resolutionHeight
   */
  paintingToSimulation(x, y, paintingRectangle, resolutionWidth, resolutionHeight) {
    return {
      x: x * (resolutionWidth / paintingRectangle.width),
      y: y * (resolutionHeight / paintingRectangle.height),
    };
  }

  /**
   * Screen pixels straight to simulation texels -- the composition of the two
   * conversions above, which is what the splat path actually wants.
   */
  screenToSimulation(x, y, paintingRectangle, resolutionWidth, resolutionHeight) {
    const p = this.screenToPainting(x, y, paintingRectangle);
    return this.paintingToSimulation(
      p.x, p.y, paintingRectangle, resolutionWidth, resolutionHeight
    );
  }

  /** The whole viewport as a screen-space rectangle. */
  getScreenRectangle() {
    return new Rectangle(0, 0, this.width, this.height);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Viewport };
}
