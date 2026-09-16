'use strict';

/*
 * ColorControl -- the paint colour editor. Mounts an iro.js wheel + sliders
 * into `#color-picker-slot`.
 *
 * THE ONE RULE: iro.js speaks RGB/HSV, the simulation speaks David Li's
 * subtractive RYB pigment cube -- see docs/COLOR-PICKER-PAINT-PARITY-SPEC.md.
 * This control only ever reads/writes H,S,V,A in 0..1 (`brushColorHSVA`);
 * never `color.rgb`, which is the WIDGET's colour, not the pigment. The
 * widget's own swatches are repainted through pigment adapters so what the
 * wheel shows matches what the brush deposits -- see docs/COLOR-PICKER-PAINT-PARITY-SPEC.md
 * for why a naive RGB-rendered wheel does not.
 *
 * iro.js is MPL-2.0 -- per docs/UI-COMPONENTS.md it is never edited in place;
 * every surface here is restyled from outside through its rendered DOM
 * (`.IroWheelHue`, `.IroSliderGradient`, `.IroHandle`).
 *
 * Does NOT own the HSVA array itself: it's `Paint.brushColorHSVA`, mutated in
 * place because other readers (splat colour, brush preview, panel hue stripe)
 * hold their own reference to it.
 */

// Wheel diameter and slider height in CSS pixels. iro.js takes a single `width`
// and derives everything from it, so the slot's width is what actually decides
// the size -- these are the fallbacks used before the slot has been laid out.
const DEFAULT_PICKER_WIDTH = 200;

// iro.js reports hue in DEGREES (0..360) and saturation/value in PERCENT
// (0..100); this app stores all four channels as 0..1. Two conversions rather
// than one because the ranges differ, and a single factor would silently be
// wrong for hue.
const DEGREES = 360;
const PERCENT = 100;


class ColorControl {
  /**
   * @param {Object}   options
   * @param {HTMLElement} options.element   the slot to mount into
   * @param {HTMLElement} options.hexElement selected pigment hex output
   * @param {HTMLElement} options.modelElement active RYB/RGB label
   * @param {function(): number[]} options.getHSVA  live [h,s,v,a], all 0..1
   * @param {function(): void} options.onChange  called after the array is edited
   * @param {function(): boolean} [options.isAdditive]  true while the Digital
   *   (RGB) model is selected. The swatches follow the model the paint is
   *   actually using, so flipping the toggle must repaint the widget -- see
   *   `setAdditive()`. Defaults to Natural (subtractive) when not supplied.
   */
  constructor({
    element, hexElement, alphaElement, modelElement, whiteElement, blackElement,
    getHSVA, onChange, onAdhocChange, isAdditive,
  }) {
    this.element = element;
    this.hexElement = hexElement;
    this.alphaElement = alphaElement;
    this.modelElement = modelElement;
    this.getHSVA = getHSVA;
    this.onChange = onChange || (() => {});
    this.onAdhocChange = onAdhocChange || (() => {});
    this.isAdditive = isAdditive || (() => false);
    this.whiteElement = whiteElement;
    this.blackElement = blackElement;
    this.adhocColor = null;

    /*
     * Hand the model down to lib/iro.js, which draws every surface through
     * IroColor.hsvToRgb and needs to know which of the two cube paths to take.
     * A live function rather than a value: the toggle flips after this control
     * is built, and a snapshot would freeze the widget in the startup model.
     */
    iroAdditiveModel = () => this.isAdditive();

    /*
     * Guards the round trip. `setHSVA()` writes the app's colour into the
     * widget, which makes iro.js emit `color:change`, which would write straight
     * back into the app -- and on the way back through iro's RGB rounding the
     * value returns slightly different from what went in. Left unguarded, the
     * hue stripe and the wheel would fight each other and a dragged stripe would
     * visibly stick.
     */
    this.applying = false;

    const hsva = this.getHSVA();

    const width = this._measureWidth();

    /*
     * One iro.ColorPicker with three layout rows: the wheel for hue and
     * saturation, then value, then alpha. iro calls value "value" and alpha
     * "alpha"; both are sliders over the same colour object, so moving one
     * leaves the others alone -- which is the property the old GL picker had to
     * implement by hand with three separate `*Pressed` flags.
     */
    this.picker = new iro.ColorPicker(element, {
      width,
      color: {
        h: hsva[0] * DEGREES,
        s: hsva[1] * PERCENT,
        v: hsva[2] * PERCENT,
        a: hsva[3],
      },
      borderWidth: 1,
      borderColor: '#00000055',
      layout: [
        { component: iro.ui.Wheel },
        { component: iro.ui.Slider, options: { sliderType: 'value' } },
        { component: iro.ui.Slider, options: { sliderType: 'alpha' } },
      ],
    });

    this.picker.on('color:change', (color) => {
      if (this.applying) return;
      // White/black replace only the colour channels. Moving iro's alpha
      // slider must therefore retain the ad-hoc choice, while changing H/S/V
      // returns to the saved colour-space selection.
      const adhocAlphaOnly = !!this.adhocColor && this._sameBaseColor(color);
      if (!adhocAlphaOnly) this._setAdhocColor(null);
      this._readFromWidget(color, adhocAlphaOnly);
    });

    this._whiteHandler = () => this._setAdhocColor('white');
    this._blackHandler = () => this._setAdhocColor('black');
    if (this.whiteElement) this.whiteElement.addEventListener('click', this._whiteHandler);
    if (this.blackElement) this.blackElement.addEventListener('click', this._blackHandler);
    this._pickerPointerHandler = (event) => {
      if (this.adhocColor && event.target.closest && event.target.closest('.IroWheel .IroHandle--0')) {
        this._setAdhocColor(null);
      }
    };
    this.element.addEventListener('pointerdown', this._pickerPointerHandler, true);

    this._copyHandler = () => this._copyHex();
    this._copyKeyHandler = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this._copyHex();
    };
    if (this.hexElement) {
      this.hexElement.addEventListener('click', this._copyHandler);
      this.hexElement.addEventListener('keydown', this._copyKeyHandler);
    }
    this._updateReadout();

    /*
     * Resize with the slot. The panel is draggable and the layout has
     * breakpoints, so the slot's width is not fixed -- and iro.js sizes itself
     * once at construction. A ResizeObserver on the slot rather than a window
     * listener, for the same reason the canvas uses one: the slot's box can
     * change without the window's doing so.
     */
    this.observer = new ResizeObserver(() => this._resize());
    this.observer.observe(element);
  }

  _measureWidth() {
    const rect = this.element.getBoundingClientRect();
    // Before first layout the slot can measure 0, and a 0-width wheel is
    // invisible rather than an error -- so fall back rather than trust it.
    return rect.width > 0 ? Math.round(rect.width) : DEFAULT_PICKER_WIDTH;
  }

  _resize() {
    const width = this._measureWidth();
    if (this.element.parentElement) {
      this.element.parentElement.style.setProperty('--picker-wheel-size', width + 'px');
    }
    if (width === this.picker.state.width) return;
    this.picker.resize(width);
  }

  /**
   * Called when the Natural/Digital toggle moves. The two models composite
   * differently AND display differently (`rybToRgb`'s `#ifdef RGB` branch), so
   * the swatches have to change with them or the widget goes back to describing
   * a colour the paint is not using.
   */
  setAdditive() {
    /*
     * The wheel's two hue gradients are built ONCE at module load (they are
     * expensive and never change while the model is fixed), so a re-render
     * alone would redraw the sliders and handles in the new model while the
     * ring kept the old one -- a half-converted widget, which is worse than
     * either model on its own. Rebuild them first, then re-render.
     */
    if (typeof iro.rebuildHueGradients === 'function') iro.rebuildHueGradients();

    // setState is iro's own re-render entry (it is what setOptions uses).
    // Passing the current colour is a no-op change that still forces the
    // vdom pass, which is exactly what is wanted: the colour did not move,
    // only the space it is drawn in.
    this.picker.setState({ color: this.picker.color });
    this._updateReadout();
  }

  /** Return the colour actually displayed/deposited by the active paint model. */
  _pigmentHex() {
    if (this.adhocColor === 'black') return '#000000';
    if (this.adhocColor === 'white') return '#FFFFFF';
    const hsva = this.getHSVA();
    const rgb = hsvToPigmentRgb(hsva[0], hsva[1], hsva[2], this.isAdditive());
    const channel = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16).padStart(2, '0');
    return ('#' + channel(rgb[0]) + channel(rgb[1]) + channel(rgb[2])).toUpperCase();
  }

  _updateReadout() {
    const hex = this._pigmentHex();
    if (this.hexElement) this.hexElement.textContent = hex;
    if (this.alphaElement) {
      const alpha = Math.round(Math.max(0, Math.min(1, this.getHSVA()[3])) * 255)
        .toString(16).padStart(2, '0').toUpperCase();
      this.alphaElement.textContent = alpha;
      this.alphaElement.style.backgroundColor = hex + alpha;
      this.alphaElement.setAttribute('aria-label', `Alpha ${alpha}`);
    }
    if (this.modelElement) this.modelElement.textContent = this.isAdditive() ? 'RGB' : 'RYB';
  }

  _sameBaseColor(color) {
    const hsva = this.getHSVA();
    const hsv = color.hsv;
    const hueDelta = Math.abs(hsv.h / DEGREES - hsva[0]);
    return Math.min(hueDelta, 1 - hueDelta) < 1e-4 &&
      Math.abs(hsv.s / PERCENT - hsva[1]) < 1e-4 &&
      Math.abs(hsv.v / PERCENT - hsva[2]) < 1e-4;
  }

  _setAdhocColor(color) {
    if (color !== null && color !== 'white' && color !== 'black') {
      throw new TypeError('Ad-hoc colour must be white, black, or null.');
    }
    if (this.adhocColor === color) return;
    this.adhocColor = color;
    if (color) this.element.dataset.adhocColor = color;
    else delete this.element.dataset.adhocColor;
    if (this.whiteElement) this.whiteElement.setAttribute('aria-pressed', color === 'white' ? 'true' : 'false');
    if (this.blackElement) this.blackElement.setAttribute('aria-pressed', color === 'black' ? 'true' : 'false');
    this._updateReadout();
    this.onAdhocChange(color);
  }

  async _copyHex() {
    const hex = this._pigmentHex();
    try {
      await navigator.clipboard.writeText(hex);
      if (this.hexElement) {
        this.hexElement.dataset.copied = 'true';
        this.hexElement.title = 'Copied ' + hex;
        this.hexElement.setAttribute('aria-label', 'Copied ' + hex);
        window.setTimeout(() => {
          delete this.hexElement.dataset.copied;
          this.hexElement.title = 'Copy paint color';
          this.hexElement.setAttribute('aria-label', 'Copy paint color');
        }, 1200);
      }
    } catch (error) {
      // Clipboard access can be denied outside a secure context. Keep the
      // current value selectable/copyable instead of changing paint state.
      if (this.hexElement) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(this.hexElement);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  /*
   * Widget -> pigment: every surface that must show pigment (disc raster,
   * slider gradients, handle fills) calls `IroColor.pigmentRgb()` in
   * lib/iro.js explicitly. `color.rgb` is stock iro's additive HSV->RGB, not
   * pigment -- never read it for display. This file still owns WHICH model is
   * drawn; see `setAdditive()`.
   */

  /*
   * Widget -> app. Mutates the live array in place; see the class comment on
   * why it is never replaced. Only H, S, V, A cross this line -- `color.rgb`
   * is the widget's rendering of the hue, not the pigment.
   */
  _readFromWidget(color, alphaOnly = false) {
    const hsva = this.getHSVA();
    const hsv = color.hsv;

    if (!alphaOnly) {
      hsva[0] = hsv.h / DEGREES;
      hsva[1] = hsv.s / PERCENT;
      hsva[2] = hsv.v / PERCENT;
    }
    hsva[3] = color.alpha;

    this._updateReadout();
    this.onChange();
  }

  /**
   * App -> widget. Called when something OTHER than this control changed the
   * colour: the panel's hue stripe, or an undo that restored an older colour.
   *
   * Guarded against the echo back through `color:change` -- see `this.applying`.
   */
  setHSVA(hsva) {
    this._setAdhocColor(null);
    this.applying = true;
    try {
      this.picker.color.set({
        h: hsva[0] * DEGREES,
        s: hsva[1] * PERCENT,
        v: hsva[2] * PERCENT,
        a: hsva[3],
      });
      this._updateReadout();
    } finally {
      // In a finally so a throw inside iro.js cannot leave the control wedged
      // permanently ignoring its own events -- which would look like a picker
      // that silently stopped working.
      this.applying = false;
    }
  }

  setAdhocColor(color) {
    if (color !== null && color !== 'white' && color !== 'black') {
      throw new TypeError('Ad-hoc paint color must be white, black, or null.');
    }
    this._setAdhocColor(color);
  }

  /** Release the observer. Nothing in this app tears the panel down today, but
   *  a second host might, and an observer on a removed element leaks. */
  destroy() {
    this.observer.disconnect();
    if (this.hexElement) {
      this.hexElement.removeEventListener('click', this._copyHandler);
      this.hexElement.removeEventListener('keydown', this._copyKeyHandler);
    }
    if (this.whiteElement) this.whiteElement.removeEventListener('click', this._whiteHandler);
    if (this.blackElement) this.blackElement.removeEventListener('click', this._blackHandler);
    this.element.removeEventListener('pointerdown', this._pickerPointerHandler, true);
  }
}

// If using modules:
// export default ColorControl;
