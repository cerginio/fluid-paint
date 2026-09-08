'use strict';

/*
 * The floating tool panel (Phase 7).
 *
 * Owns three behaviours that the old canvas-drawn panel could not have had,
 * because it was pixels in the drawing surface rather than an element:
 *
 *   - dragging, by the grip, anywhere in the window
 *   - collapsing to a compact bar that is still fully usable
 *   - the two controls on that bar: brush size and a hue stripe
 *
 * Why a floating panel rather than a docked column. The Phase 6 device retest
 * scored phones 3.7/5 against the tablet's 5/5, and screen area was the theme.
 * A docked 300px column takes a third of a phone's width away from the
 * painting permanently; a floating panel that collapses to a 40px bar gives it
 * back, and the user chooses where the bar sits rather than the layout choosing
 * for them.
 *
 * This module deliberately knows nothing about the engine. It reports what the
 * user did through callbacks, and paint.js decides what that means -- so the
 * panel can be replaced (Phase 8 swaps the picker for iro.js) without touching
 * simulation code.
 */

/** Where the panel is placed on a phone, where it should start out of the way. */
const PANEL_COLLAPSE_BELOW_CSS_WIDTH = 640;

class ToolPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root       #ui
   * @param {HTMLElement} options.grip       the drag handle
   * @param {HTMLElement} options.hueStripe  the hue gradient
   * @param {(hue:number)=>void} options.onHue       hue in [0,1)
   * @param {() => void}  [options.onLayoutChange]   fired after a move/collapse
   */
  constructor(options) {
    this.root = options.root;
    this.grip = options.grip;
    this.hueStripe = options.hueStripe;
    this.hueHandle = this.hueStripe ? this.hueStripe.querySelector('.handle') : null;
    this.onHue = options.onHue || (() => {});
    this.onLayoutChange = options.onLayoutChange || (() => {});

    this._dragPointerId = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    // A drag that never really moved is a TAP, and a tap toggles the panel.
    // Without this the grip would need two separate targets for two actions,
    // which is exactly the kind of chrome a phone has no room for.
    this._dragMoved = false;

    this._installDrag();
    this._installHueStripe();

    // Start collapsed on a phone: the painting is what the user came for, and
    // the bar alone is enough to paint with.
    if (window.innerWidth <= PANEL_COLLAPSE_BELOW_CSS_WIDTH) {
      this.setCollapsed(true);
    }

    // Keep the panel on screen when the window changes. A panel dragged to the
    // right edge in landscape is entirely off screen in portrait, and with no
    // grip reachable there is no way back -- the user would have to reload.
    this._onWindowResize = () => this.clampIntoView();
    window.addEventListener('resize', this._onWindowResize);
  }

  // --- collapse -------------------------------------------------------------

  isCollapsed() {
    return this.root.getAttribute('data-collapsed') === 'true';
  }

  setCollapsed(collapsed) {
    this.root.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    // The body is hidden by CSS; the panel's height changes, so a panel pinned
    // near the bottom edge could end up mostly off screen when it expands.
    this.clampIntoView();
    this.onLayoutChange();
  }

  toggleCollapsed() {
    this.setCollapsed(!this.isCollapsed());
  }

  // --- dragging -------------------------------------------------------------

  _installDrag() {
    if (!this.grip) return;

    this.grip.addEventListener('pointerdown', (event) => {
      // Only the primary button/contact drags; a second finger landing on the
      // grip mid-drag must not retarget the panel.
      if (this._dragPointerId !== null) return;
      event.preventDefault();

      const rect = this.root.getBoundingClientRect();
      this._dragPointerId = event.pointerId;
      this._dragOffsetX = event.clientX - rect.left;
      this._dragOffsetY = event.clientY - rect.top;
      this._dragMoved = false;

      // Capture on the grip, so a fast drag that outruns the pointer still
      // delivers its moves here rather than to whatever is underneath -- which
      // would be the canvas, and would paint a stroke across the picture.
      try { this.grip.setPointerCapture(event.pointerId); } catch (e) { /* synthetic ids throw */ }
    });

    this.grip.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this._dragPointerId) return;
      event.preventDefault();

      // A few pixels of slop before it counts as a drag: fingers wobble, and
      // without this every tap would register as a one-pixel move and the
      // toggle would never fire.
      const DRAG_SLOP = 3;
      const rect = this.root.getBoundingClientRect();
      const nextLeft = event.clientX - this._dragOffsetX;
      const nextTop = event.clientY - this._dragOffsetY;

      if (!this._dragMoved &&
          Math.abs(nextLeft - rect.left) + Math.abs(nextTop - rect.top) > DRAG_SLOP) {
        this._dragMoved = true;
      }
      if (!this._dragMoved) return;

      this.moveTo(nextLeft, nextTop);
    });

    const endDrag = (event) => {
      if (event.pointerId !== this._dragPointerId) return;
      this._dragPointerId = null;
      try { this.grip.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }

      if (!this._dragMoved) this.toggleCollapsed();
    };

    this.grip.addEventListener('pointerup', endDrag);
    this.grip.addEventListener('pointercancel', endDrag);
  }

  /** Move the panel, keeping it reachable. */
  moveTo(left, top) {
    const clamped = this._clampPosition(left, top);
    this.root.style.left = clamped.left + 'px';
    this.root.style.top = clamped.top + 'px';
    this.onLayoutChange();
  }

  /**
   * Keep at least a grip's worth of the panel on screen.
   *
   * Not the whole panel: on a phone the panel is nearly the full width, so
   * demanding it fit entirely would stop the user pushing it aside to see the
   * painting underneath. What must never happen is the panel becoming
   * unreachable, and that means keeping the BAR visible, since the grip lives
   * on it.
   */
  _clampPosition(left, top) {
    const rect = this.root.getBoundingClientRect();
    const MIN_VISIBLE = 56;
    const maxLeft = window.innerWidth - MIN_VISIBLE;
    const maxTop = window.innerHeight - MIN_VISIBLE;

    return {
      left: Math.max(MIN_VISIBLE - rect.width, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
    };
  }

  clampIntoView() {
    const rect = this.root.getBoundingClientRect();
    this.moveTo(rect.left, rect.top);
  }

  // --- the hue stripe -------------------------------------------------------

  _installHueStripe() {
    if (!this.hueStripe) return;

    let pointerId = null;

    const pick = (event) => {
      const rect = this.hueStripe.getBoundingClientRect();
      if (rect.width === 0) return;
      const t = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      // The gradient wraps (red at both ends), so 1 and 0 are the same hue.
      // Report < 1 so a hue of exactly 1 can never be stored and then read back
      // as a different colour by code that assumes [0,1).
      this.setHue(t >= 1 ? 0 : t);
      this.onHue(this.hue);
    };

    this.hueStripe.addEventListener('pointerdown', (event) => {
      if (pointerId !== null) return;
      event.preventDefault();
      pointerId = event.pointerId;
      try { this.hueStripe.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      pick(event);
    });

    this.hueStripe.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();
      pick(event);
    });

    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      try { this.hueStripe.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    };

    this.hueStripe.addEventListener('pointerup', end);
    this.hueStripe.addEventListener('pointercancel', end);
  }

  /**
   * Move the stripe's handle. Display only -- it does NOT fire onHue, so the
   * app can push the current colour in (from the full picker, or an undo)
   * without that echoing back as a user edit and overwriting saturation and
   * value.
   */
  setHue(hue) {
    this.hue = hue;
    if (this.hueHandle) this.hueHandle.style.left = (hue * 100).toFixed(3) + '%';
  }

  /**
   * Repaint the hue stripe in pigment (Phase 10).
   *
   * The stripe is the hue control while the panel is collapsed, so it has to
   * name the same colour the wheel and the canvas do. Its CSS gradient is
   * authored in RGB and is about 120deg away from the pigment -- see the note
   * on `#bar-hue-stripe` in app/layout.css.
   *
   * Sampled rather than given six stops, because the pigment path between hues
   * is curved; the reasoning is the same as for the wheel's ring, in
   * app/ui/color.js.
   *
   * @param {boolean} additive  true while the Digital (RGB) model is selected
   */
  paintHueStripe(additive) {
    if (!this.hueStripe || typeof cssPigment !== 'function') return;
    const STOPS = 24;
    const stops = [];
    for (let i = 0; i <= STOPS; i++) {
      const t = i / STOPS;
      stops.push(cssPigment(t, 1, 1, additive) + ' ' + (t * 100).toFixed(2) + '%');
    }
    this.hueStripe.style.background = 'linear-gradient(to right, ' + stops.join(', ') + ')';
  }

  destroy() {
    window.removeEventListener('resize', this._onWindowResize);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToolPanel };
}
