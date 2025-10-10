// ES6 class version of Slider (Pointer Events)

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
  constructor(element, initialValue, minValue, maxValue, changeCallback) {
    this.div = element;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.changeCallback = changeCallback;

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

    // Utilities (fallbacks if your Utilities helper isn’t present)
    const clamp = (typeof Utilities?.clamp === 'function')
      ? Utilities.clamp
      : (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const getRelativeX = (clientX) => {
      const rect = element.getBoundingClientRect();
      return clientX - rect.left; // in CSS px
    };

    // Redraw UI from current value
    const redraw = () => {
      // Recompute length each time in case of responsive layout
      const L = element.offsetWidth;
      const H = element.offsetHeight;

      const fraction = (this.value - this.minValue) / (this.maxValue - this.minValue);
      const px = Math.floor(fraction * L);

      sliderLeftDiv.style.width = px + 'px';

      sliderRightDiv.style.width = (L - px) + 'px';
      sliderRightDiv.style.left = px + 'px';

      handleDiv.style.left = (px - H / 2) + 'px';
    };

    // Apply a pointer change
    const applyFromX = (cssX) => {
      // Use current width (responsive-safe)
      const L = element.offsetWidth;
      const fraction = clamp(cssX / Math.max(1, L), 0, 1);
      this.value = this.minValue + fraction * (this.maxValue - this.minValue);
      this.changeCallback(this.value);
      redraw();
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
    };

    const onPointerCancel = (e) => {
      if (e.pointerId !== activePointerId) return;
      endInteraction();
    };

    // Attach listeners (non-passive so we can preventDefault for touch)
    element.addEventListener('pointerdown', onPointerDown, { passive: false });
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', onPointerUp, { passive: false });
    element.addEventListener('pointercancel', onPointerCancel, { passive: false });
    element.addEventListener('lostpointercapture', onPointerCancel, { passive: true });

    // Public API (same as original)
    this.setValue = (newValue) => {
      this.value = clamp(newValue, this.minValue, this.maxValue);
      redraw();
    };
    this.getValue = () => this.value;

    redraw();
  }
}

// If using modules:
// export default Slider;
