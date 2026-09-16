/*
 * Viewport — the single owner of every coordinate transform.
 *
 * Four coordinate spaces coexist in this app:
 *
 *   1. CSS pixels      what the DOM and pointer events speak. Y grows DOWN.
 *   2. Screen pixels   the canvas backing store, = CSS pixels * devicePixelRatio.
 *                      Y grows UP -- this is the GL convention the whole
 *                      renderer and all the UI hit-testing already use.
 *   3. Painting pixels `paintingRectangle`, the painting's rect in screen pixels.
 *   4. Simulation texels  painting pixels * resolutionScale.
 *
 * Everything that converts between them goes through here, so the rest of the
 * code cannot express a coordinate bug -- it never sees two spaces at once.
 * The Y-flip in particular happens exactly once, in cssToScreen(): forgetting
 * it at a new input path would be a silent bug, so nothing gets the chance.
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
    this.useResponsivePixelRatioCap = opts.useResponsivePixelRatioCap !== undefined
      ? opts.useResponsivePixelRatioCap
      : true;

    // The element whose CSS box decides the canvas size. CSS decides the box,
    // the canvas fills whatever it's given.
    //
    // Defaults to NULL, not canvas.parentElement -- deliberately. Falling back
    // to the parent looks harmless but isn't: a canvas appended straight to
    // <body> would measure body's box, and body's height is content-driven, so
    // it would be sized BY the canvas it's supposed to be sizing. That
    // feedback loop only shows up at devicePixelRatio 2, where the two sizings
    // stop agreeing. A container is opt-in; without one the viewport falls
    // back to window sizing, which an embedding host that never adopts a
    // container relies on.
    this.container = opts.container || null;

    this.pixelRatio = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    // Quarter-turn applied only to the presentation canvas. The simulation and
    // painting rectangle stay in their original coordinate system; rotating
    // those would alter saved pixels rather than merely following the device.
    this.presentationRotation = 0;

    // Presentation-only camera. World coordinates remain stable for the
    // simulation and export; zoom/pan only decide where those coordinates land
    // in the canvas backing store.
    this.viewScale = 1;
    this.viewOffsetX = 0;
    this.viewOffsetY = 0;
    this.minViewScale = opts.minViewScale !== undefined ? opts.minViewScale : 0.25;
    this.maxViewScale = opts.maxViewScale !== undefined ? opts.maxViewScale : 8;
    // Zoom shows a short-lived, static cue at the gesture anchor. It is not a
    // camera transition and never follows, eases toward, or drifts with the
    // pointer after the zoom event.
    this.focusIndicator = null;
    this.focusIndicatorDuration = 600;

    this.resize();
  }

  /**
   * The ratio actually in force: the device's, clamped, or exactly 1 when
   * disabled. Kept as a method so the clamping rule lives in one place.
   */
  computePixelRatio() {
    if (!this.pixelRatioEnabled) return 1;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    let cap = this.maxPixelRatio;

    // Width media alone cannot identify an Android phone in "Desktop site"
    // mode. CSS capability media publishes the device policy as a custom
    // property; explicit ?dpr= diagnostics opt out through the constructor.
    if (this.useResponsivePixelRatioCap &&
        typeof getComputedStyle === 'function' && this.canvas) {
      const raw = getComputedStyle(this.canvas)
        .getPropertyValue('--canvas-max-pixel-ratio')
        .trim();
      const responsiveCap = Number.parseFloat(raw);
      if (Number.isFinite(responsiveCap) && responsiveCap > 0) {
        cap = Math.min(cap, responsiveCap);
      }
    }

    return Math.max(1, Math.min(cap, dpr));
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
        return this.presentationRotation % 2 === 0
          ? { width: rect.width, height: rect.height }
          : { width: rect.height, height: rect.width };
      }
      if (this.cssWidth > 0 && this.cssHeight > 0) {
        return { width: this.cssWidth, height: this.cssHeight };
      }
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** Rotate the presentation canvas by a quarter turn, without rotating paint data. */
  setPresentationRotation(quarterTurns) {
    const normalized = ((quarterTurns % 4) + 4) % 4;
    const changed = this.presentationRotation !== normalized;
    this.presentationRotation = normalized;
    return changed;
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

    // With a container the CSS size is asserted at EVERY ratio; without one
    // it's written only when the ratio is not 1.
    //
    // Under a container the element must carry an explicit CSS size: without
    // it, layout size comes from the backing store, and a canvas whose backing
    // store comes from a box sized by the canvas is a feedback loop.
    // app/layout.css avoids that loop another way too (window-bounded grid, so
    // the cell is never content-sized) -- this write is the guard that still
    // holds if a later layout gives the cell an auto track.
    //
    // Without a container, writing the style at ratio 1 breaks output: the
    // canvas then measures <body>, whose height is content-driven.
    if (this.container !== null || pixelRatio !== 1) {
      this.canvas.style.width = cssWidth + 'px';
      this.canvas.style.height = cssHeight + 'px';
    }

    if (this.container !== null) {
      const containerRect = this.container.getBoundingClientRect();
      if (this.presentationRotation === 0) {
        this.canvas.style.left = '0px';
        this.canvas.style.top = '0px';
        this.canvas.style.transform = '';
        this.canvas.style.transformOrigin = '';
      } else {
        // Centre the unrotated layout box first; rotating around that centre
        // then makes its swapped bounds exactly fill the container.
        this.canvas.style.left = (containerRect.width - cssWidth) * 0.5 + 'px';
        this.canvas.style.top = (containerRect.height - cssHeight) * 0.5 + 'px';
        this.canvas.style.transform = 'rotate(' + (this.presentationRotation * 90) + 'deg)';
        this.canvas.style.transformOrigin = 'center center';
      }
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
    if (this.presentationRotation === 1) {
      return { x: y * this.pixelRatio, y: x * this.pixelRatio };
    }
    const ratio = this.pixelRatio;
    return { x: x * ratio, y: this.height - y * ratio };
  }

  /** The inverse of cssToScreen, for anything that has to hand a value back. */
  screenToCss(x, y) {
    if (this.presentationRotation === 1) {
      return { x: y / this.pixelRatio, y: x / this.pixelRatio };
    }
    const ratio = this.pixelRatio;
    return { x: x / ratio, y: (this.height - y) / ratio };
  }

  /** A CSS-space drag delta expressed in the rotated canvas's screen space. */
  cssDeltaToScreen(dx, dy) {
    if (this.presentationRotation === 1) {
      return { x: dy * this.pixelRatio, y: dx * this.pixelRatio };
    }
    return { x: dx * this.pixelRatio, y: -dy * this.pixelRatio };
  }

  /**
   * A length in CSS pixels expressed in screen pixels. Use it for anything
   * authored in CSS units -- UI panel sizes, hit-test margins, line widths --
   * so those keep their apparent size instead of shrinking as the DPR rises.
   */
  cssLengthToScreen(length) {
    return length * this.pixelRatio;
  }

  // --- world <-> screen view transform ------------------------------------

  worldToScreen(x, y) {
    return {
      x: x * this.viewScale + this.viewOffsetX,
      y: y * this.viewScale + this.viewOffsetY,
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.viewOffsetX) / this.viewScale,
      y: (y - this.viewOffsetY) / this.viewScale,
    };
  }

  worldDeltaToScreen(dx, dy) {
    return { x: dx * this.viewScale, y: dy * this.viewScale };
  }

  screenDeltaToWorld(dx, dy) {
    return { x: dx / this.viewScale, y: dy / this.viewScale };
  }

  worldRectToScreen(rectangle) {
    const origin = this.worldToScreen(rectangle.left, rectangle.bottom);
    return new Rectangle(
      origin.x,
      origin.y,
      rectangle.width * this.viewScale,
      rectangle.height * this.viewScale
    );
  }

  panViewBy(dx, dy) {
    this.focusIndicator = null;
    this.viewOffsetX += dx;
    this.viewOffsetY += dy;
  }

  expireFocusIndicator(now) {
    if (this.focusIndicator !== null && now >= this.focusIndicator.visibleUntil) {
      this.focusIndicator = null;
    }
  }

  /** The visible zoom marker, or null outside its short display window. */
  getFocusIndicator() {
    if (this.focusIndicator === null) return null;
    return { x: this.focusIndicator.x, y: this.focusIndicator.y };
  }

  /** Place a static focus cue at the current zoom anchor. */
  showFocusIndicator(screenX, screenY, now) {
    this.focusIndicator = {
      x: screenX,
      y: screenY,
      visibleUntil: now + this.focusIndicatorDuration,
    };
  }

  /** Set absolute zoom while keeping the world point beneath the anchor fixed. */
  zoomViewAt(screenX, screenY, nextScale, canvasBounds) {
    const scale = Math.max(this.minViewScale, Math.min(this.maxViewScale, nextScale));
    if (scale === this.viewScale) return false;

    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    // Center an overview immediately. There is no focus-driven camera motion;
    // the overlay only marks the zoom event's anchor.
    if (scale <= 0.75 && scale < this.viewScale) {
      this.viewScale = scale;
      this.viewOffsetX = (this.width - this.width * scale) * 0.5;
      this.viewOffsetY = (this.height - this.height * scale) * 0.5;
      this.showFocusIndicator(screenX, screenY, now);
      return true;
    }

    const previousScale = this.viewScale;
    const focusAnchor = this.screenToWorld(screenX, screenY);
    this.viewScale = scale;
    this.viewOffsetX = screenX - focusAnchor.x * scale;
    this.viewOffsetY = screenY - focusAnchor.y * scale;

    // When zooming in from outside the canvas, ordinary anchor-preserving zoom
    // expands the canvas away from the pointer. On each outside axis, translate
    // the view back so the nearest edge moves to the pointer. The other axis is
    // untouched and keeps its normal zoom-anchor behaviour.
    if (scale > previousScale && canvasBounds) {
      const ratio = scale / previousScale;
      const oldRight = canvasBounds.getRight();
      const oldTop = canvasBounds.getTop();
      const zoomedLeft = screenX + (canvasBounds.left - screenX) * ratio;
      const zoomedRight = screenX + (oldRight - screenX) * ratio;
      const zoomedBottom = screenY + (canvasBounds.bottom - screenY) * ratio;
      const zoomedTop = screenY + (oldTop - screenY) * ratio;

      if (screenX < canvasBounds.left) this.viewOffsetX += screenX - zoomedLeft;
      else if (screenX > oldRight) this.viewOffsetX += screenX - zoomedRight;

      if (screenY < canvasBounds.bottom) this.viewOffsetY += screenY - zoomedBottom;
      else if (screenY > oldTop) this.viewOffsetY += screenY - zoomedTop;
    }

    this.showFocusIndicator(screenX, screenY, now);
    return true;
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
