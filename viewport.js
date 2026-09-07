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

    // The element whose CSS box decides the canvas size (Phase 7). Before this
    // the size came from window.innerWidth/innerHeight directly, which pinned
    // the canvas to the whole window and is exactly why the chrome could not be
    // laid out around it -- any DOM that took space would be drawn OVER the
    // canvas rather than beside it, because the canvas did not know the DOM
    // existed. Sizing from a container inverts that: CSS decides the box, the
    // canvas fills whatever it is given.
    //
    // Defaults to NULL, not to canvas.parentElement, and that is deliberate.
    //
    // Falling back to the parent looks harmless and is not: a canvas appended
    // straight to <body> would then measure body's box, and body's height is
    // content-driven, so it is sized BY the canvas it is supposed to be sizing.
    // Measured, that costs the dpr2 goldens -- all six drifted while all six
    // dpr1 rows passed, because at ratio 1 the two happened to agree.
    //
    // So a container is opt-in. Without one the viewport keeps its pre-Phase-7
    // window sizing exactly, which is also what the golden harness and any
    // embedding host that never adopts the layout rely on.
    this.container = opts.container || null;

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
   * The CSS size the canvas should occupy, read from the container's laid-out
   * box. Falls back to the window when there is no container, which keeps a
   * bare `new Viewport(canvas)` working exactly as it did before Phase 7.
   *
   * getBoundingClientRect() is deliberate: it reports the FRACTIONAL box, and
   * a grid cell in a flexible layout is routinely a fractional number of CSS
   * pixels wide. clientWidth would round, and rounding here would make the
   * backing store disagree with the element's real size by up to a pixel --
   * which reads as a persistent half-pixel blur along one edge.
   */
  measureCssSize() {
    if (this.container !== null) {
      const rect = this.container.getBoundingClientRect();
      // A container that is display:none, or measured before layout, reports
      // 0. Sizing a canvas to 0 loses the GL drawing buffer and every texture
      // built from it, so refuse to act on a degenerate box and keep the last
      // good size instead.
      if (rect.width > 0 && rect.height > 0) {
        return { width: rect.width, height: rect.height };
      }
      if (this.cssWidth > 0 && this.cssHeight > 0) {
        return { width: this.cssWidth, height: this.cssHeight };
      }
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /**
   * Size the canvas to its container. The backing store is CSS size * ratio;
   * the CSS size is pinned explicitly so the element still occupies its cell
   * rather than growing to the backing store's size.
   *
   * @returns {boolean} whether anything actually changed
   */
  resize() {
    const cssSize = this.measureCssSize();
    const cssWidth = cssSize.width;
    const cssHeight = cssSize.height;
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

    // With a container the CSS size is asserted at EVERY ratio; without one the
    // pre-Phase-7 rule stands, and it is written only when the ratio is not 1.
    //
    // Under a container the element must carry an explicit CSS size, because
    // otherwise its layout size is its backing store -- and a canvas that takes
    // its backing store from a box that is itself sized by the canvas is a
    // feedback loop. app/layout.css avoids that loop a second way (the grid is
    // window-bounded, so the cell is never content-sized), and measurement says
    // that bound is what currently carries the load; this write is the guard
    // that keeps holding if a later layout gives the cell an auto track.
    //
    // Without a container the old exemption is kept rather than tidied away.
    // That is not tidiness either: writing the style at ratio 1 changed the
    // dpr2 golden hashes when this was first attempted, because the canvas was
    // then measuring <body>, whose height is content-driven. Leaving the
    // no-container path untouched is what keeps 12/12 byte-identical.
    if (this.container !== null || pixelRatio !== 1) {
      this.canvas.style.width = cssWidth + 'px';
      this.canvas.style.height = cssHeight + 'px';
    }

    return changed;
  }

  /**
   * Call `callback` whenever the container's box changes.
   *
   * A ResizeObserver rather than window's `resize` event, because the container
   * changes size for reasons the window never hears about: a panel opening, a
   * breakpoint swapping the grid, a drawer collapsing. The window event also
   * misses the case the layout exists for -- chrome appearing beside the canvas
   * and shrinking it while the window itself never moved.
   *
   * Falls back to the window event where ResizeObserver is missing; the
   * fallback is strictly worse (it cannot see layout-only changes) but it is
   * the same behaviour the app had before Phase 7, so nothing regresses.
   *
   * @returns {function(): void} an unsubscribe function
   */
  observeResize(callback) {
    if (this.container !== null && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => callback());
      observer.observe(this.container);
      // The window listener stays ALONGSIDE the observer, and is not
      // redundant: devicePixelRatio changes when a window moves between
      // displays of different densities, which resizes the backing store
      // without changing the container's CSS box at all. A ResizeObserver
      // sees nothing in that case.
      window.addEventListener('resize', callback);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', callback);
      };
    }

    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
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
