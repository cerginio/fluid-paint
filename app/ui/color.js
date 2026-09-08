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
 * WIDGET, not the pigment that hue becomes. Those two are different by design
 * and conflating them is the exact mistake §3b warns about.
 *
 * ---------------------------------------------------------------------------
 * PHASE 10: the widget now shows PIGMENT, not light
 * ---------------------------------------------------------------------------
 *
 * Phase 8 left the above rule intact on the data path but drew the widget in
 * iro's own RGB, on the reasoning that "a user picking blue should see blue".
 * That reasoning was wrong, and measurably so: `hsvToRyb()` is not a round trip
 * with `rybToRgb()`, so the hue the wheel NAMES is not the hue the canvas
 * PAINTS. Measured across the wheel (see app/ui/ryb.js for the table):
 *
 *     wheel says blue   (240deg) -> canvas paints pure YELLOW
 *     wheel says yellow ( 60deg) -> canvas paints purple
 *     wheel says green  (120deg) -> canvas paints slate blue
 *
 * Red is the only fixed point; everything else is off by roughly 120deg. So the
 * picker was not showing "an RGB interpretation of the hue" -- it was showing a
 * different colour from the one about to come out of the brush. That is the
 * additive/subtractive mismatch, and it is what `_repaint()` below fixes.
 *
 * The fix is the one the OLD picker already had. `app/shaders/picker.frag:52`:
 *
 *     vec3 hsvToRgb (vec3 hsv) { return rybToRgb(hsv2ryb(hsv)); }
 *
 * -- every swatch went through the same two steps as the paint. `_repaint()`
 * does exactly that in CSS, for the four surfaces iro.js paints from its own
 * RGB assumption. The geometry, hit-testing, handles and events remain iro's.
 *
 * Note what did NOT change: the H/S/V/A boundary above is untouched, and the
 * hue the user picks is still the same number. Only its swatch moved. The
 * golden hashes are the proof -- they are unchanged by this phase, because
 * nothing here is on the paint path.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT PATCH lib/iro.js
 * ---------------------------------------------------------------------------
 *
 * iro.js is MPL-2.0 and docs/UI-COMPONENTS.md sets the rule: do not edit it in
 * place, wrap it, keep the copyleft boundary where it is. Every surface below is
 * therefore restyled from OUTSIDE, through the DOM iro rendered. The class names
 * used (`.IroWheelHue`, `.IroSliderGradient`, `.IroHandle`) are iro's public
 * rendered output, and the Phase 8 probe already asserts them.
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
   * @param {function(): boolean} [options.isAdditive]  true while the Digital
   *   (RGB) model is selected. The swatches follow the model the paint is
   *   actually using, so flipping the toggle must repaint the widget -- see
   *   `setAdditive()`. Defaults to Natural (subtractive) when not supplied.
   */
  constructor({ element, getHSVA, onChange, isAdditive }) {
    this.element = element;
    this.getHSVA = getHSVA;
    this.onChange = onChange || (() => {});
    this.isAdditive = isAdditive || (() => false);

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
  }

  /*
   * ------------------------------------------------------------------------
   * Widget -> pigment
   * ------------------------------------------------------------------------
   *
   * There is deliberately no repaint code here any more.
   *
   * The first version of this phase overwrote iro's rendered DOM from outside
   * -- the ring's conic-gradient, both slider gradients, the handle fills -- to
   * avoid editing a vendored file. That worked, but it meant re-deriving in CSS
   * what iro already computes internally, and racing its re-renders to do it.
   *
   * The colour space now lives where it belongs: `IroColor.hsvToRgb` in
   * lib/iro.js goes through the pigment cube, and every surface derives from
   * that one function -- so the ring, the sliders, the handles and `color.rgb`
   * are all pigment with no help from here. lib/iro.js is this project's own
   * long-standing fork, not a pristine upstream drop, so fixing it at the
   * source is the honest place for it.
   *
   * What this file still owns is WHICH model is drawn -- see `setAdditive()`.
   */

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
