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
    this.bar = this.root.querySelector('#panel-bar');
    this.grip = options.grip;
    this.hueStripe = options.hueStripe;
    this.hueHandle = this.hueStripe ? this.hueStripe.querySelector('.handle') : null;
    this.onHue = options.onHue || (() => {});
    this.onLayoutChange = options.onLayoutChange || (() => {});
    this.extension = options.extension || null;
    this.extensionGrip = options.extensionGrip || null;
    this.extensionToggle = options.extensionToggle || null;
    this.extensionClose = options.extensionClose || null;
    this.onExtensionClose = options.onExtensionClose || (() => {});
    this.extensionTabs = [];
    this.extensionPages = [];

    this._dragPointerId = null;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    // A drag that never really moved is a TAP, and a tap toggles the panel.
    // Without this the grip would need two separate targets for two actions,
    // which is exactly the kind of chrome a phone has no room for.
    this._dragMoved = false;
    this._dragGrip = null;
    this._dragTap = null;

    this._installDrag();
    this._installHueStripe();
    this._installExtension();

    // Start collapsed on a phone: the painting is what the user came for, and
    // the bar alone is enough to paint with.
    const coarsePhone = typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse) and (hover: none)').matches &&
      Math.min(screen.width, screen.height) <= PANEL_COLLAPSE_BELOW_CSS_WIDTH;
    if (window.innerWidth <= PANEL_COLLAPSE_BELOW_CSS_WIDTH || coarsePhone) {
      this.setCollapsed(true);
    } else {
      this.clampIntoView();
    }

    // Keep the panel on screen when the window changes. A panel dragged to the
    // right edge in landscape is entirely off screen in portrait, and with no
    // grip reachable there is no way back -- the user would have to reload.
    this._onWindowResize = () => {
      this.clampIntoView();
      requestAnimationFrame(() => this._placeExtension());
    };
    window.addEventListener('resize', this._onWindowResize);
  }

  // --- collapse -------------------------------------------------------------

  isCollapsed() {
    return this.root.getAttribute('data-collapsed') === 'true';
  }

  setCollapsed(collapsed) {
    const barTop = this._barTop();
    this.root.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    if (collapsed) this.setExtensionOpen(false, false);
    // The body is hidden by CSS; the panel's height changes, so a panel pinned
    // near the bottom edge could end up mostly off screen when it expands.
    this.moveTo(this.root.getBoundingClientRect().left, barTop);
    this.onLayoutChange();
  }

  toggleCollapsed() {
    this.setCollapsed(!this.isCollapsed());
  }

  // --- dragging -------------------------------------------------------------

  _installDrag() {
    this._installDragTarget(this.grip, () => this.toggleCollapsed());
    this._installDragTarget(this.extensionGrip, () => this.toggleExtensionCollapsed());
    if (this.extensionGrip) {
      this.extensionGrip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.toggleExtensionCollapsed();
      });
    }
  }

  _installDragTarget(grip, onTap) {
    if (!grip) return;

    grip.addEventListener('pointerdown', (event) => {
      // Only the primary button/contact drags; a second finger landing on the
      // grip mid-drag must not retarget the panel.
      if (this._dragPointerId !== null) return;
      event.preventDefault();

      const rect = this.root.getBoundingClientRect();
      const barRect = this.bar.getBoundingClientRect();
      this._dragPointerId = event.pointerId;
      this._dragOffsetX = event.clientX - rect.left;
      this._dragOffsetY = event.clientY - barRect.top;
      this._dragMoved = false;
      this._dragGrip = grip;
      this._dragTap = onTap;

      // Capture on the grip, so a fast drag that outruns the pointer still
      // delivers its moves here rather than to whatever is underneath -- which
      // would be the canvas, and would paint a stroke across the picture.
      try { grip.setPointerCapture(event.pointerId); } catch (e) { /* synthetic ids throw */ }
    });

    grip.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this._dragPointerId || this._dragGrip !== grip) return;
      event.preventDefault();

      // A few pixels of slop before it counts as a drag: fingers wobble, and
      // without this every tap would register as a one-pixel move and the
      // toggle would never fire.
      const DRAG_SLOP = 3;
      const rect = this.root.getBoundingClientRect();
      const barRect = this.bar.getBoundingClientRect();
      const nextLeft = event.clientX - this._dragOffsetX;
      const nextTop = event.clientY - this._dragOffsetY;

      if (!this._dragMoved &&
          Math.abs(nextLeft - rect.left) + Math.abs(nextTop - barRect.top) > DRAG_SLOP) {
        this._dragMoved = true;
      }
      if (!this._dragMoved) return;

      this.moveTo(nextLeft, nextTop);
    });

    const endDrag = (event) => {
      if (event.pointerId !== this._dragPointerId || this._dragGrip !== grip) return;
      this._dragPointerId = null;
      try { grip.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }

      const tap = this._dragTap;
      this._dragGrip = null;
      this._dragTap = null;
      if (!this._dragMoved && tap) tap();
    };

    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
  }

  /** Move the panel by its header coordinate, keeping that header reachable. */
  moveTo(left, barTop) {
    const barHeight = this.bar.getBoundingClientRect().height || 40;
    const viewportHeight = this._viewportHeight();
    const bodyAbove = !this.isCollapsed() && barTop + barHeight / 2 > viewportHeight / 2;
    this.root.setAttribute('data-body-placement', bodyAbove ? 'above' : 'below');

    const clamped = this._clampPosition(left, barTop);
    const rootHeight = this.root.getBoundingClientRect().height;
    const rootTop = bodyAbove ? clamped.top - (rootHeight - barHeight) : clamped.top;
    this.root.style.left = clamped.left + 'px';
    this.root.style.top = rootTop + 'px';
    this._placeExtension();
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
  _clampPosition(left, barTop) {
    const rect = this.root.getBoundingClientRect();
    const barHeight = this.bar.getBoundingClientRect().height || 40;
    const MIN_VISIBLE = 56;
    const maxLeft = window.innerWidth - MIN_VISIBLE;
    const maxTop = this._viewportHeight() - barHeight;

    return {
      left: Math.max(MIN_VISIBLE - rect.width, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, barTop)),
    };
  }

  clampIntoView() {
    const rect = this.root.getBoundingClientRect();
    this.moveTo(rect.left, this._barTop());
  }

  _viewportHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  _barTop() {
    return this.bar ? this.bar.getBoundingClientRect().top : this.root.getBoundingClientRect().top;
  }

  // --- extension shell -----------------------------------------------------

  isExtensionCollapsed() {
    return !!this.extension && this.extension.getAttribute('data-collapsed') === 'true';
  }

  setExtensionCollapsed(collapsed) {
    if (!this.extension) return;
    this.extension.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    if (this.extensionGrip) this.extensionGrip.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    this._placeExtension();
    this.onLayoutChange();
  }

  toggleExtensionCollapsed() {
    this.setExtensionCollapsed(!this.isExtensionCollapsed());
  }

  setExtensionHasStory(hasStory) {
    if (this.extension) this.extension.setAttribute('data-has-story', hasStory ? 'true' : 'false');
  }

  _installExtension() {
    if (!this.extension || !this.extensionToggle) return;

    this.extensionToggle.addEventListener('click', (event) => {
      event.preventDefault();
      this.setExtensionOpen(this.extension.hidden);
    });
    if (this.extensionClose) {
      this.extensionClose.addEventListener('click', (event) => {
        event.preventDefault();
        this.setExtensionOpen(false);
      });
    }

    this.extensionTabs = [...this.extension.querySelectorAll('[data-extension-tab]')];
    this.extensionPages = [...this.extension.querySelectorAll('[data-extension-page]')];
    for (const [index, tab] of this.extensionTabs.entries()) {
      tab.addEventListener('click', () => {
        this.selectExtensionTab(tab.getAttribute('data-extension-tab'));
      });
      tab.addEventListener('keydown', (event) => {
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % this.extensionTabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + this.extensionTabs.length) % this.extensionTabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = this.extensionTabs.length - 1;
        else return;
        event.preventDefault();
        const next = this.extensionTabs[nextIndex];
        this.selectExtensionTab(next.getAttribute('data-extension-tab'), true);
      });
    }
    const selected = this.extensionTabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    if (selected) this.selectExtensionTab(selected.getAttribute('data-extension-tab'));
  }

  selectExtensionTab(selected, focus = false) {
    if (!this.extension) return;
    for (const tab of this.extensionTabs) {
      const active = tab.getAttribute('data-extension-tab') === selected;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (active && focus) tab.focus();
    }
    for (const page of this.extensionPages) {
      page.hidden = page.getAttribute('data-extension-page') !== selected;
    }
  }

  setExtensionOpen(open, notifyClose = true) {
    if (!this.extension || !this.extensionToggle) return;
    const wasOpen = !this.extension.hidden;
    const next = !!open && !this.isCollapsed();
    this.extension.hidden = !next;
    this.extensionToggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    this.extensionToggle.textContent = next ? '−' : '+';
    this._placeExtension();
    this.onLayoutChange();
    if (notifyClose && wasOpen && !next) this.onExtensionClose();
  }

  /** Use an adjacent side when it fits; otherwise overlay the base panel. */
  _placeExtension() {
    if (!this.extension || this.extension.hidden) return;
    const panel = this.root.getBoundingClientRect();
    const extensionWidth = this.extension.getBoundingClientRect().width;
    const gap = 8;
    const roomRight = window.innerWidth - panel.right;
    const roomLeft = panel.left;

    let side;
    if (roomRight >= extensionWidth + gap) side = 'right';
    else if (roomLeft >= extensionWidth + gap) side = 'left';
    else side = panel.left + panel.width / 2 < window.innerWidth / 2 ? 'overlay-right' : 'overlay-left';
    this.root.setAttribute('data-extension-side', side);

    this.extension.style.removeProperty('transform');
    if (getComputedStyle(this.extension).position === 'fixed') {
      // backdrop-filter makes this nominally fixed child use #ui as its
      // containing block in Chromium. Counter-shift it after a parent drag so
      // the phone sheet still respects the viewport's 8px gutters.
      const fixedRect = this.extension.getBoundingClientRect();
      const shift = fixedRect.left < 8 ? 8 - fixedRect.left
        : fixedRect.right > window.innerWidth - 8
          ? window.innerWidth - 8 - fixedRect.right
          : 0;
      if (shift) this.extension.style.transform = `translateX(${shift}px)`;
      return;
    }

    // An overlay is positioned inside a panel that the user may deliberately
    // leave partly off-screen. Clamp the extension itself so its header/grip
    // never follows the parent beyond the viewport edge.
    this.extension.style.removeProperty('left');
    this.extension.style.removeProperty('right');
    if (side.startsWith('overlay')) {
      const preferredLeft = side === 'overlay-right'
        ? panel.right - extensionWidth
        : panel.left;
      const viewportLeft = Math.max(0, Math.min(window.innerWidth - extensionWidth, preferredLeft));
      this.extension.style.left = (viewportLeft - panel.left) + 'px';
      this.extension.style.right = 'auto';
    }
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
