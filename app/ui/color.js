'use strict';

/*
 * ColorControl -- the paint colour editor, Phase 8.
 *
 * Replaces `colorpicker.js`, which drew a hue ring, a saturation/value square
 * and an alpha slider with two GL programs (`picker.vert`/`picker.frag`) into
 * the main canvas, and hit-tested them with hand-written circle and box maths.
 * That is now an iro.js wheel plus two iro.js sliders, mounted as real DOM into
 * `#color-picker-slot` -- the box Phase 7 reserved for exactly this.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: iro.js speaks RGB/HSV. The simulation speaks RYB.
 * ---------------------------------------------------------------------------
 *
 * §3b of the extraction plan: the paint model is David Li's SUBTRACTIVE RYB
 * pigment cube, not RGB. Yellow over blue is green there and grey in RGB. The
 * conversion happens at `hsvToRyb()`, in the host, on the way to `splat()` --
 * and this file's whole job is to make sure an RGB picker's assumptions stop
 * here rather than leaking inward.
 *
 * Concretely, that means this control **only ever reads and writes H, S, V and
 * A as numbers in 0..1**, which is the app's existing `brushColorHSVA` contract.
 * It never hands an RGB triple to anything downstream, and it never asks iro.js
 * what colour the paint "is" -- iro's own `color.rgb` is the colour of the
 * WIDGET, which is an RGB rendering of the hue the user picked, not the pigment
 * that hue becomes. Those two are different by design and conflating them is the
 * exact mistake §3b warns about.
 *
 * The wheel therefore shows an RGB interpretation of the chosen hue. That is
 * correct and intended: it is a colour *chooser*, and a user picking "blue"
 * should see blue. What the paint then does with that hue is the simulation's
 * business, and the Digital/Natural toggle is what says which model composites.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT own
 * ---------------------------------------------------------------------------
 *
 * The HSVA array itself. It is `Paint.brushColorHSVA`, reached through an
 * accessor and **mutated in place**, exactly as `ColorPicker` did -- several
 * other readers hold a reference to that array (the splat colour, the brush
 * preview, the panel's hue stripe), and replacing it would silently orphan them.
 * The accessor rather than the object is the Phase 5 shape: this file can reach
 * one named thing, not any field of its owner.
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
   * @param {function(): number[]} options.getHSVA  live [h,s,v,a], all 0..1
   * @param {function(): void} options.onChange  called after the array is edited
   */
  constructor({ element, getHSVA, onChange }) {
    this.element = element;
    this.getHSVA = getHSVA;
    this.onChange = onChange || (() => {});

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
      this._readFromWidget(color);
    });

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
    if (width === this.picker.state.width) return;
    this.picker.resize(width);
  }

  /*
   * Widget -> app. Mutates the live array in place; see the class comment on
   * why it is never replaced.
   *
   * Only H, S, V and A cross this line. `color.rgb` is deliberately not read:
   * it is the widget's RGB rendering of the hue, not the pigment, and letting it
   * inward is precisely the §3b leak this control exists to prevent.
   */
  _readFromWidget(color) {
    const hsva = this.getHSVA();
    const hsv = color.hsv;

    hsva[0] = hsv.h / DEGREES;
    hsva[1] = hsv.s / PERCENT;
    hsva[2] = hsv.v / PERCENT;
    hsva[3] = color.alpha;

    this.onChange();
  }

  /**
   * App -> widget. Called when something OTHER than this control changed the
   * colour: the panel's hue stripe, or an undo that restored an older colour.
   *
   * Guarded against the echo back through `color:change` -- see `this.applying`.
   */
  setHSVA(hsva) {
    this.applying = true;
    try {
      this.picker.color.set({
        h: hsva[0] * DEGREES,
        s: hsva[1] * PERCENT,
        v: hsva[2] * PERCENT,
        a: hsva[3],
      });
    } finally {
      // In a finally so a throw inside iro.js cannot leave the control wedged
      // permanently ignoring its own events -- which would look like a picker
      // that silently stopped working.
      this.applying = false;
    }
  }

  /** Release the observer. Nothing in this app tears the panel down today, but
   *  a second host might, and an observer on a removed element leaks. */
  destroy() {
    this.observer.disconnect();
  }
}

// If using modules:
// export default ColorControl;
