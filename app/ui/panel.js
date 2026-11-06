'use strict';

/*
 * The floating tool panel: draggable by the grip, collapses to a compact bar
 * (brush size + hue stripe) that stays fully usable, so it costs a phone
 * screen far less area than a docked column.
 *
 * Deliberately knows nothing about the engine -- reports what the user did
 * through callbacks, and paint.js decides what that means, so the panel's
 * internals can change without touching simulation code.
 */

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
    this.returnButton = options.returnButton || null;
    this.uiApi = options.uiApi || null;
    this._lastUiConfig = null;
    this._desiredAnchor = null;
    this._bottomAnchored = window.parent !== window ||
      (!!this.uiApi && this.uiApi.getConfig().mode !== 'full');
    this._layoutFrame = null;
    this._returnFrame = null;
    this._listeners = [];
    this._destroyed = false;
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
    this._layoutObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this._scheduleLayout()) : null;
    for (const element of [this.root, this.bar, this.extension]) {
      if (element) this._layoutObserver?.observe(element);
    }
    this._onFluidUiLayoutChanged = () => this.refreshFluidUi();
    document.addEventListener('fluid-ui-layout-changed', this._onFluidUiLayoutChanged);
    this._onWindowResize = () => this._scheduleLayout();
    window.addEventListener('resize', this._onWindowResize);
    this._visualViewport = window.visualViewport;
    this._visualViewport?.addEventListener('resize', this._onWindowResize);
    this._visualViewport?.addEventListener('scroll', this._onWindowResize);
    if (this.uiApi) {
      const onUiState = (state) => {
        if (state.resolvedFeatures.length) this._lastUiConfig = state.config;
        this._scheduleLayout();
      };
      onUiState(this.uiApi.getState());
      this._unsubscribeUi = this.uiApi.subscribe(onUiState);
    }
    if (this.returnButton) {
      this._onReturn = async () => {
        this.returnButton.disabled = true;
        try {
          this._bottomAnchored = true;
          this._desiredAnchor = null;
          if (this.root.hidden && this._lastUiConfig) await this.uiApi.configure(this._lastUiConfig);
          this._layout();
          this.grip.focus({ preventScroll: true });
        } catch (error) {
          console.error('Could not restore tools:', error);
        } finally {
          this.returnButton.disabled = false;
        }
      };
      this._onReturnClick = (event) => {
        if (event.detail === 0) this._onReturn();
      };
      this.returnButton.addEventListener('click', this._onReturnClick);
      let returnPress = null;
      const returnDown = (event) => {
        if (event.button !== 0 || event.isPrimary === false || returnPress) return;
        event.preventDefault();
        returnPress = { id: event.pointerId, x: event.clientX, y: event.clientY };
        try { this.returnButton.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointer */ }
      };
      const returnEnd = (event) => {
        if (returnPress?.id !== event.pointerId) return;
        const press = returnPress;
        returnPress = null;
        try { this.returnButton.releasePointerCapture(event.pointerId); } catch (_) { /* capture lost */ }
        if (event.type === 'pointerup' && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 8) {
          // Keep the target mounted until the compatibility click is routed.
          this._returnFrame = requestAnimationFrame(() => {
            this._returnFrame = null;
            if (!this._destroyed) this._onReturn();
          });
        }
      };
      for (const [type, handler] of [['pointerdown', returnDown], ['pointerup', returnEnd],
        ['pointercancel', returnEnd], ['lostpointercapture', returnEnd]]) {
        this.returnButton.addEventListener(type, handler);
        this._listeners.push(() => this.returnButton.removeEventListener(type, handler));
      }
      this._onReturnKey = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) this.returnButton.click();
      };
      this.returnButton.addEventListener('keydown', this._onReturnKey);
    }
    this.setCollapsed(true);
  }

  // --- collapse -------------------------------------------------------------

  isCollapsed() {
    return this.root.getAttribute('data-collapsed') === 'true';
  }

  setCollapsed(collapsed) {
    this.root.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    this.grip.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    const label = (collapsed ? 'Expand' : 'Collapse') + ' tools; drag to move';
    this.grip.setAttribute('aria-label', label);
    this.grip.title = label;
    this._layout();
  }

  toggleCollapsed() {
    this.setCollapsed(!this.isCollapsed());
  }

  /** Right-click treats the attached panels as one disclosure group. */
  toggleAllCollapsed() {
    const extensionOpen = !!this.extension && !this.extension.hidden;
    const everythingCollapsed = this.isCollapsed() &&
      (!extensionOpen || this.isExtensionCollapsed());
    const collapse = !everythingCollapsed;
    this.setCollapsed(collapse);
    if (extensionOpen) this.setExtensionCollapsed(collapse);
  }

  // --- dragging -------------------------------------------------------------

  _installDrag() {
    this._installDragTarget(this.grip, () => this.toggleCollapsed());
    this._onGripClick = (event) => {
      if (event.detail > 0) return;
      this.toggleCollapsed();
    };
    this.grip.addEventListener('click', this._onGripClick);
    this._onGripKey = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.toggleCollapsed();
    };
    this.grip.addEventListener('keydown', this._onGripKey);
    this._listeners.push(() => this.grip.removeEventListener('keydown', this._onGripKey));
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

    const listen = (type, handler) => {
      grip.addEventListener(type, handler);
      this._listeners.push(() => grip.removeEventListener(type, handler));
    };
    listen('pointerdown', (event) => {
      // Only the primary button/contact drags; a second finger landing on the
      // grip mid-drag must not retarget the panel.
      if (this._dragPointerId !== null || event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      if (grip === this.grip) {
        grip.focus({ preventScroll: true });
      }

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

    listen('pointermove', (event) => {
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
      const canceled = event.type !== 'pointerup';
      if (!this._dragMoved && !canceled && tap) tap();
    };

    listen('pointerup', endDrag);
    listen('pointercancel', endDrag);
    listen('lostpointercapture', endDrag);
  }

  /** Move the desired bar anchor, never the transient root/body bounds. */
  moveTo(left, barTop) {
    this._bottomAnchored = false;
    this._desiredAnchor = { left, top: barTop };
    this._layout();
  }

  _scheduleLayout() {
    if (this._destroyed || this._layoutFrame !== null) return;
    this._layoutFrame = requestAnimationFrame(() => {
      this._layoutFrame = null;
      if (!this._destroyed) this._layout();
    });
  }

  _viewportBounds() {
    const viewport = this._visualViewport;
    const style = getComputedStyle(this.root);
    const inset = (side) => Math.max(12,
      parseFloat(style.getPropertyValue('--panel-safe-' + side)) || 0);
    const left = (viewport?.offsetLeft || 0) + inset('left');
    const top = (viewport?.offsetTop || 0) + inset('top');
    const right = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - inset('right');
    const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - inset('bottom');
    return { left, top, right, bottom };
  }

  _layout() {
    const bounds = this._viewportBounds();
    if (this.returnButton) {
      this.returnButton.style.right = 'auto';
      this.returnButton.style.bottom = 'auto';
      this.returnButton.style.left = Math.max(bounds.left, bounds.right - 44) + 'px';
      this.returnButton.style.top = Math.max(bounds.top, bounds.bottom - 44) + 'px';
    }
    const visible = !this.root.hidden && this.root.getBoundingClientRect().width > 0;
    if (!visible) {
      if (this.returnButton) this.returnButton.hidden = !this._lastUiConfig;
      return;
    }
    this.root.style.maxWidth = Math.max(0, bounds.right - bounds.left) + 'px';
    const barHeight = this.bar.getBoundingClientRect().height;
    if (!barHeight) return;
    if (!this._desiredAnchor) {
      this._desiredAnchor = {
        left: bounds.left,
        top: this._bottomAnchored ? bounds.bottom - barHeight - 1 : bounds.top + 1,
      };
    }
    const desired = this._desiredAnchor;
    const top = Math.max(bounds.top + 1, Math.min(bounds.bottom - barHeight - 1,
      this._bottomAnchored ? bounds.bottom - barHeight - 1 : desired.top));
    const above = top + barHeight / 2 > (bounds.top + bounds.bottom) / 2;
    this.root.setAttribute('data-body-placement', above ? 'above' : 'below');
    const availableHeight = above ? top + barHeight - bounds.top + 1 : bounds.bottom - top + 1;
    this.root.style.maxHeight = Math.max(barHeight + 2, availableHeight) + 'px';

    const body = this.root.querySelector('#panel-body');
    if (body) {
      body.style.overflowY = 'visible';
      if (body.scrollHeight > body.clientHeight + 1) body.style.overflowY = 'auto';
    }
    const rect = this.root.getBoundingClientRect();
    const grip = this.grip.getBoundingClientRect();
    const gripOffset = grip.left - rect.left;
    const compact = window.matchMedia('(pointer: coarse), (max-width: 640px)').matches;
    const minLeft = compact ? bounds.left : bounds.left - gripOffset;
    const maxLeft = compact ? bounds.right - rect.width : bounds.right - gripOffset - grip.width;
    const left = Math.max(minLeft, Math.min(maxLeft, desired.left));
    const barOffset = this.bar.getBoundingClientRect().top - rect.top;
    this.root.style.left = left + 'px';
    this.root.style.top = (top - barOffset) + 'px';
    if (this.returnButton) {
      const atBottom = Math.abs(top + barHeight + 1 - bounds.bottom) <= 1 &&
        left >= bounds.left && left + rect.width <= bounds.right + 1;
      this.returnButton.hidden = atBottom;
    }
    this._placeExtension();
    this.onLayoutChange();
  }

  clampIntoView() {
    this._layout();
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

    // The canvas already reserves right-click for panel disclosure. Apply the
    // same gesture to the DOM panel, where canvas pointer events cannot arrive.
    this.extension.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.toggleAllCollapsed();
    });

    this.extensionTabs = [...this.extension.querySelectorAll('[data-extension-tab]')];
    this.extensionPages = [...this.extension.querySelectorAll('[data-extension-page]')];
    for (const tab of this.extensionTabs) {
      tab.addEventListener('click', () => {
        this.selectExtensionTab(tab.getAttribute('data-extension-tab'));
      });
      tab.addEventListener('keydown', (event) => {
        const available = this.extensionTabs.filter((candidate) => !candidate.hidden);
        const currentIndex = available.indexOf(tab);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % available.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + available.length) % available.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = available.length - 1;
        else return;
        event.preventDefault();
        const next = available[nextIndex];
        this.selectExtensionTab(next.getAttribute('data-extension-tab'), true);
      });
    }
    const selected = this.extensionTabs.find((tab) => !tab.hidden && tab.getAttribute('aria-selected') === 'true') ||
      this.extensionTabs.find((tab) => !tab.hidden);
    if (selected) this.selectExtensionTab(selected.getAttribute('data-extension-tab'));
  }

  refreshFluidUi() {
    this._scheduleLayout();
    if (!this.extension) return;
    const available = this.extensionTabs.filter((tab) => !tab.hidden);
    const selected = available.find((tab) => tab.getAttribute('aria-selected') === 'true') || available[0];
    if (selected) this.selectExtensionTab(selected.getAttribute('data-extension-tab'));
    else this.setExtensionOpen(false, false);
    this.clampIntoView();
  }

  selectExtensionTab(selected, focus = false) {
    if (!this.extension) return;
    const targetTab = this.extensionTabs.find((tab) =>
      !tab.hidden && tab.getAttribute('data-extension-tab') === selected
    );
    if (!targetTab) return;
    this.setExtensionCollapsed(false);
    for (const tab of this.extensionTabs) {
      const active = !tab.hidden && tab.getAttribute('data-extension-tab') === selected;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (active && focus) tab.focus();
    }
    for (const page of this.extensionPages) {
      const matchingTab = this.extensionTabs.find((tab) =>
        !tab.hidden && tab.getAttribute('data-extension-tab') === page.getAttribute('data-extension-page')
      );
      page.hidden = !matchingTab || page.getAttribute('data-extension-page') !== selected;
    }
    if (!this.extension.hidden) {
      this.extension.dispatchEvent(new CustomEvent('story-extension-tab-selected', { detail: { tab: selected } }));
    }
  }

  setExtensionOpen(open, notifyClose = true) {
    if (!this.extension || !this.extensionToggle) return;
    const wasOpen = !this.extension.hidden;
    // The extension is independent of the main panel body. In particular, the
    // compact bar's + button must expose all additional tools without forcing
    // the painter out of compact mode.
    const next = !!open;
    this.extension.hidden = !next;
    if (next && !wasOpen) {
      const selectedTab = this.extensionTabs.find((tab) => !tab.hidden && tab.getAttribute('aria-selected') === 'true');
      if (selectedTab) this.extension.dispatchEvent(new CustomEvent('story-extension-tab-selected', {
        detail: { tab: selectedTab.getAttribute('data-extension-tab') },
      }));
    }
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
      // containing block in Chromium. Counter-shift both axes after a drag
      // or resize so the phone sheet stays inside the viewport gutters.
      const fixedRect = this.extension.getBoundingClientRect();
      const shiftX = fixedRect.left < 8 ? 8 - fixedRect.left
        : fixedRect.right > window.innerWidth - 8
          ? window.innerWidth - 8 - fixedRect.right
          : 0;
      const shiftY = fixedRect.top < 8 ? 8 - fixedRect.top
        : fixedRect.bottom > window.innerHeight - 8
          ? window.innerHeight - 8 - fixedRect.bottom
          : 0;
      if (shiftX || shiftY) this.extension.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
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
    this._destroyed = true;
    this._layoutObserver?.disconnect();
    if (this._layoutFrame !== null) cancelAnimationFrame(this._layoutFrame);
    if (this._returnFrame !== null) cancelAnimationFrame(this._returnFrame);
    this._unsubscribeUi?.();
    for (const remove of this._listeners) remove();
    this.grip.removeEventListener('click', this._onGripClick);
    this.returnButton?.removeEventListener('click', this._onReturnClick);
    this.returnButton?.removeEventListener('keydown', this._onReturnKey);
    if (this.returnButton) this.returnButton.hidden = true;
    this._visualViewport?.removeEventListener('resize', this._onWindowResize);
    this._visualViewport?.removeEventListener('scroll', this._onWindowResize);
    window.removeEventListener('resize', this._onWindowResize);
    document.removeEventListener('fluid-ui-layout-changed', this._onFluidUiLayoutChanged);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToolPanel };
}
