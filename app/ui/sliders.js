// Slider -- a horizontal pointer-driven slider. Moved here from the repo root
// in Phase 8, otherwise unchanged.
//
// THE TILECRAFT FORK THE PLAN CALLED FOR WAS DELIBERATELY NOT DONE, and the
// reason is worth keeping so nobody "finishes" it later.
//
// §5a of the extraction plan specified forking tilecraft's `SlidersComponent`
// (components.js, 418 lines) into this file, keeping components.css for "the
// vertical-range styling with full vendor-prefix coverage". Reading the source
// before writing the fork showed the premise does not hold here:
//
//   - It is a VERTICAL component. It positions with `thumb.style.bottom` and
//     `bar.style.height`, and its markup is `<input type="range" orient=
//     "vertical">`. Every slider in this panel is horizontal, and the compact
//     bar's size slider is explicitly a horizontal strip beside the hue stripe.
//   - The vendor-prefixed CSS that justified taking it is ~70 of its 268 lines
//     and is entirely `input[type=range][orient=vertical]` selectors. Ported to
//     horizontal it would be rewritten, not kept.
//   - This file is 160 lines, already pointer-event based, already handles
//     pointer capture and touch-action, and is device-tested (Phase 6 retest,
//     tablet 5/5 with finger and stylus).
//
// So the fork would have been a vertical-to-horizontal port that discarded the
// asset it was taken for, replacing working device-tested code. The plan's §5a
// was written before the source was read; this is the correction.
//
// Tilecraft's component gets native `<input type=range>` semantics for free.
// This horizontal control mirrors the relevant slider role, ARIA values and
// keyboard behaviour locally without importing the unrelated vertical UI.

const SLIDER_THICKNESS = 2;
const LEFT_COLOR = 'white';
const RIGHT_COLOR = '#666666';
const HANDLE_COLOR = 'white';

class Slider {
  /**
   * @param {HTMLElement} element
   * @param {number} initialValue
   * @param {number} minValue
   * @param {number} maxValue
   * @param {(val:number)=>void} changeCallback
   */
  constructor(element, initialValue, minValue, maxValue, changeCallback, options = {}) {
    this.div = element;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.changeCallback = changeCallback;
    this.formatValue = options.formatValue || ((value) => String(value));
    this.step = options.step || (maxValue - minValue) / 100;

    element.setAttribute('role', 'slider');
    element.tabIndex = element.tabIndex < 0 ? 0 : element.tabIndex;
    element.setAttribute('aria-valuemin', String(minValue));
    element.setAttribute('aria-valuemax', String(maxValue));
    if (options.label) element.setAttribute('aria-label', options.label);

    // Prevent touch scrolling/zooming while interacting
    // (needed for proper Pointer Events behavior on mobile)
    if (!this.div.style.touchAction) this.div.style.touchAction = 'none';

    // Track value internally
    this.value = initialValue;

    // Initial layout numbers
    const height = element.offsetHeight;
    const length = element.offsetWidth;

    // Left (filled) track
    const sliderLeftDiv = document.createElement('div');
    sliderLeftDiv.style.position = 'absolute';
    sliderLeftDiv.style.width = length + 'px';
    sliderLeftDiv.style.height = SLIDER_THICKNESS.toFixed(0) + 'px';
    sliderLeftDiv.style.backgroundColor = LEFT_COLOR;
    sliderLeftDiv.style.top = (height / 2 - SLIDER_THICKNESS / 2) + 'px';
    sliderLeftDiv.style.zIndex = 999;
    element.appendChild(sliderLeftDiv);

    // Right (unfilled) track
    const sliderRightDiv = document.createElement('div');
    sliderRightDiv.style.position = 'absolute';
    sliderRightDiv.style.width = length + 'px';
    sliderRightDiv.style.height = SLIDER_THICKNESS.toFixed(0) + 'px';
    sliderRightDiv.style.backgroundColor = RIGHT_COLOR;
    sliderRightDiv.style.top = (height / 2 - SLIDER_THICKNESS / 2) + 'px';
    element.appendChild(sliderRightDiv);

    // Handle
    const handleDiv = document.createElement('div');
    handleDiv.style.position = 'absolute';
    handleDiv.style.width = height + 'px';
    handleDiv.style.height = height + 'px';
    handleDiv.style.borderRadius = height * 0.5 + 'px';
    handleDiv.style.cursor = 'ew-resize';
    handleDiv.style.background = HANDLE_COLOR;
    // Improve hit target a bit
    handleDiv.style.touchAction = 'none';
    element.appendChild(handleDiv);

    const valuePop = document.createElement('output');
    valuePop.className = 'slider-value-pop';
    valuePop.setAttribute('aria-live', 'polite');
    valuePop.hidden = true;
    element.appendChild(valuePop);
    let valuePopTimer = null;

    const showValue = () => {
      valuePop.textContent = this.formatValue(this.value);
      valuePop.hidden = false;
      if (valuePopTimer !== null) clearTimeout(valuePopTimer);
      valuePopTimer = null;
    };

    const hideValueLater = () => {
      if (valuePopTimer !== null) clearTimeout(valuePopTimer);
      valuePopTimer = setTimeout(() => {
        valuePop.hidden = true;
        valuePopTimer = null;
      }, 700);
    };

    // Utilities (fallbacks if your Utilities helper isn’t present)
    const clamp = (typeof Utilities?.clamp === 'function')
      ? Utilities.clamp
      : (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const getRelativeX = (clientX) => {
      const rect = element.getBoundingClientRect();
      return clientX - rect.left; // in CSS px
    };

    // Redraw UI from current value. Width AND height are read here: both can
    // change when an orientation media query starts matching, so retaining the
    // constructor's handle size would leave only the track responsive.
    const redraw = () => {
      // Recompute geometry each time in case of responsive layout.
      const L = element.offsetWidth;
      const H = element.offsetHeight;

      const fraction = (this.value - this.minValue) / (this.maxValue - this.minValue);
      const px = Math.floor(fraction * L);

      sliderLeftDiv.style.width = px + 'px';
      sliderLeftDiv.style.top = (H / 2 - SLIDER_THICKNESS / 2) + 'px';

      sliderRightDiv.style.width = (L - px) + 'px';
      sliderRightDiv.style.left = px + 'px';
      sliderRightDiv.style.top = (H / 2 - SLIDER_THICKNESS / 2) + 'px';

      handleDiv.style.width = H + 'px';
      handleDiv.style.height = H + 'px';
      handleDiv.style.borderRadius = H * 0.5 + 'px';
      handleDiv.style.left = (px - H / 2) + 'px';
      valuePop.style.left = px + 'px';
      element.setAttribute('aria-valuenow', String(this.value));
      element.setAttribute('aria-valuetext', this.formatValue(this.value));
    };

    // Apply a pointer change
    const applyFromX = (cssX) => {
      // Use current width (responsive-safe)
      const L = element.offsetWidth;
      const fraction = clamp(cssX / Math.max(1, L), 0, 1);
      this.value = this.minValue + fraction * (this.maxValue - this.minValue);
      this.changeCallback(this.value);
      redraw();
      showValue();
    };

    const onKeyDown = (event) => {
      let next = this.value;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += this.step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= this.step;
      else if (event.key === 'Home') next = this.minValue;
      else if (event.key === 'End') next = this.maxValue;
      else return;
      event.preventDefault();
      this.value = clamp(next, this.minValue, this.maxValue);
      this.changeCallback(this.value);
      redraw();
      showValue();
      hideValueLater();
    };

    // Pointer Events
    let activePointerId = null;

    const onPointerDown = (e) => {
      // Only react to primary button / primary touch
      if (e.isPrimary === false) return;

      // Prevent scroll on touch/pen while interacting
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault();
      }

      activePointerId = e.pointerId;
      // Capture so we keep getting moves outside the element
      try { element.setPointerCapture(activePointerId); } catch {}

      const x = getRelativeX(e.clientX);
      applyFromX(x);
    };

    const onPointerMove = (e) => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault();
      }
      const x = getRelativeX(e.clientX);
      applyFromX(x);
    };

    const endInteraction = () => {
      if (activePointerId !== null) {
        try { element.releasePointerCapture(activePointerId); } catch {}
        activePointerId = null;
      }
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== activePointerId) return;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        e.preventDefault();
      }
      endInteraction();
      hideValueLater();
    };

    const onPointerCancel = (e) => {
      if (e.pointerId !== activePointerId) return;
      endInteraction();
      hideValueLater();
    };

    // Attach listeners (non-passive so we can preventDefault for touch)
    element.addEventListener('pointerdown', onPointerDown, { passive: false });
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', onPointerUp, { passive: false });
    element.addEventListener('pointercancel', onPointerCancel, { passive: false });
    element.addEventListener('lostpointercapture', onPointerCancel, { passive: true });
    element.addEventListener('keydown', onKeyDown);

    // Public API (same as original)
    this.setValue = (newValue) => {
      this.value = clamp(newValue, this.minValue, this.maxValue);
      redraw();
    };
    this.getValue = () => this.value;

    // CSS changes the slider box at responsive breakpoints. In particular,
    // rotating a phone swaps the portrait and landscape widths without any
    // value change that would otherwise redraw the custom track and handle.
    // Observe the actual box as the primary signal, and also listen for the
    // orientation event so embedded/older browsers that delay or omit a
    // ResizeObserver delivery still refresh after their media queries settle.
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(redraw)
      : null;
    if (this.resizeObserver) this.resizeObserver.observe(element);

    this._onOrientationChange = () => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(redraw);
      } else {
        setTimeout(redraw, 0);
      }
    };
    window.addEventListener('orientationchange', this._onOrientationChange, { passive: true });

    this.destroy = () => {
      if (valuePopTimer !== null) clearTimeout(valuePopTimer);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      element.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('orientationchange', this._onOrientationChange);
    };

    redraw();
  }
}

// If using modules:
// export default Slider;
