# Vendored UI components

What was vendored, from where, at what version, and what was changed.

Started in Phase 6 with the pointer dispatcher; `lib/iro.js` arrived in Phase 8.
The **sliders fork was deliberately not done** -- see the section at the bottom,
because a plan item that was dropped on purpose is worth more written down than a
plan item that was silently skipped.

## `app/ui/pointer-dispatcher.js`

| | |
|---|---|
| Source | `D:\work\js-games\ua-dream\tilecraft\lib\pointer-dispatcher.js` |
| Vendored | Phase 6, 2026-09-07 |
| Upstream size | 808 lines |
| Licence | The project author's own code (same author as this project) |
| Source sha256 | `bb2770e85719b8c9b74e7cc1bc4747c3ddfd2f1b4e49b0d745d3f8a2b0fb4611` |

Supplies pointer bookkeeping, multi-pointer gesture recognition
(`pan` / `pan2` / `pinch` / `rotate2` / `rotate3`), a per-frame RAF flush with
accumulated deltas, velocity smoothing, hold/tap/swipe, and a cached element
rect. It replaced the hand-rolled `activePointers` map and the `onPointer*`
handlers in `paint.js`.

### Changes from upstream

**One patch**, marked `LOCAL PATCH` in the file:

`_move()` treated the mere *existence* of `getCoalescedEvents` as proof it
would return samples:

```js
const samples = (typeof e.getCoalescedEvents === 'function')
    ? e.getCoalescedEvents()
    : [e];
```

A **synthetic** `PointerEvent` — `dispatchEvent`, which is what the golden
harness and any automated test uses — has the method but returns an **empty
list**. `samples` was therefore `[]`, the loop never ran, and no
`pan` / `pan2` / `pinch` was ever emitted. `panstart` and `panend` still fired,
which is what makes the failure look like working input: a stroke begins, ends,
and deposits nothing in between.

The patch falls back to the event itself when the list is empty. Real input is
unaffected — a trusted move always coalesces to at least one sample.

This is worth keeping in mind if the file is ever re-synced from upstream: the
patch must be re-applied, and the symptom of losing it is silent, not an error.

### Integration notes — do not "simplify" these

**Coordinates are adapted at the boundary, not in the vendored file.**
The dispatcher reports CSS-relative pixels, **Y-down** from the top-left, scaled
by its own reading of the canvas backing store. This app's screen space is
**Y-up** from the bottom-left and `Viewport` owns the device pixel ratio.
`Paint._toScreen()` and `Paint._deltaToScreen()` convert; nothing downstream
sees a raw dispatcher coordinate. Two separate helpers exist because a *delta*
takes the scale but no origin — its Y flip is a sign change, not a subtraction
from the height. Running a delta through `_toScreen()` would add the viewport
height to it every frame.

The dispatcher deriving DPR from the DOM while `Viewport` computes it is two
sources of truth for one number. They agree today only because `Viewport.resize()`
deliberately skips writing `canvas.style.width` at ratio 1. Adapting through
`Viewport` keeps the app's answer authoritative.

**The brush position is read from the dispatcher's live pointer state, not from
the `pan` event.** See `Paint._syncBrushToPointer()`. The dispatcher defers
`pan` to its own RAF; the render loop's RAF is registered first, and RAF
callbacks run in registration order, so acting only on the event left the brush
one frame behind the pointer every frame. `Brush.update()` derives bristle speed
from the delta it is handed, so a stale position does not merely lag visually —
it changes how much paint is deposited (measured: ~2% more, same path, same
colour, same splat count, which is exactly the kind of drift that looks like
noise). Gesture *recognition* still comes from the dispatcher, which genuinely
wants accumulated per-frame deltas.

**`pan2` and `pinch` both fire for every two-finger gesture.** The dispatcher
only withholds a pinch whose scale is exactly 1. Two fingers landing on the same
frame make the first frame's scale spike — measured ~1.19 for a span that never
changed — so a per-frame scale test flips the mode to RESIZING and a two-finger
drag silently becomes a resize. `onGesturePinch()` therefore measures the span
against the span the *gesture started with* (`pinchStartSpan`), which cannot
spike because it starts at exactly 1, and gates on `PINCH_SCALE_DEADZONE`. It
applies the total ratio to `pinchStartViewScale`, so zoom cannot compound frame
over frame and never enters the destructive resize path.

**`getResizingSide()` was NOT deleted**, though the extraction plan called for
it. A pinch has a scale about a centroid but no notion of *which* edge is being
dragged, and that is what drives the asymmetric clamping in
`_resizePaintingTo()`, the `offsetX`/`offsetY` anchoring in `_commitResize()`,
and the resize **cursor** (`cursorForResizingSide`). Deleting it would have
replaced edge-anchored mouse resizing with centroid scaling — a different
feature, not the same one. Pinch was added *alongside* it as the touch path.

The floating `ToolPanel` now treats its compact bar as the stable drag anchor.
Its body opens below that bar in the upper viewport half and above it in the
lower half, with a sub-half-viewport scroll cap. The optional File/Player
extension chooses a free adjacent side and falls back to an in-panel overlay on
narrow phones.

### What the goldens cannot see

Gesture behaviour, pen pressure and hover are all invisible to golden images —
they never call `save()`, never enter the resize preview, and drive only a
single-pointer mouse stroke. Phase 6 was verified with a throwaway probe
(`debug/phase6-probe2.js`, deleted after use per the `debug/` convention) that
drove pen pressure, two-finger pan, pinch and hover directly, with these
expected values:

| Check | Expected |
|---|---|
| mouse at the spec's no-hardware `pressure: 0.5` | brush height **100** (unscaled) |
| pen at 1.0 | 100 |
| pen at 0.25 | 25 |
| pen at 0 | 15 (floored at `MIN_PRESSURE_SCALE`, never 0) |
| two-finger drag, fingers +50 CSS x / +30 CSS y | `movedX +50`, `movedY -30`, mode never RESIZING |
| pinch with a growing span | painting width grows |
| hover | brush moves, mode stays NONE |

**Sabotage-verified**: inverting the X delta made `movedX` −50, and dropping the
`pointerType !== 'pen'` guard made the mouse height 50. Both were caught, so the
passes mean something. If either path is rewritten, write the probe back.

## `lib/iro.js`

| | |
|---|---|
| Source | `D:\work\js-games\ua-dream\tilecraft\lib\iro.js` |
| Upstream | iro.js **v5.5.2**, (c) 2016-2021 James Daniel, <https://github.com/jaames/iro.js> |
| Vendored | Phase 8, 2026-09-08 |
| Size | 1850 lines as vendored, UMD build with Preact bundled (2131 after the Phase 10 patches) |
| **Licence** | **MPL 2.0** |
| Vendored sha256 | `98223fc8c15b3c576715d8e147ead241ae3fc5f906dc38c56b1857774987589d` — the **as-vendored** file. The working copy is patched and will not match; see the modifications below. |

Supplies the colour wheel and the value/alpha sliders behind `app/ui/color.js`.
It replaced `colorpicker.js`, its two GL programs (`app/shaders/picker.vert` /
`picker.frag`, both deleted) and its hand-written circle/box hit tests.

### MPL-2.0 obligations, and how they are met

MPL 2.0 is **file-level** copyleft: the obligation attaches to the file, not to
the program that links it. Concretely, for this project:

1. **The file keeps its copyright banner.** The `/*! iro.js v5.5.2 ... Licensed
   under MPL 2.0 */` header at the top of `lib/iro.js` is intact and must stay.
2. **Source availability.** `lib/iro.js` is the source, it is in this repository
   unminified, and the upstream URL is recorded above.
3. **Modifications must be disclosed.** There is one. See below.
4. ~~**Do not edit it in place.**~~ **Superseded in Phase 10.** This rule was
   followed until restyling iro's rendered DOM from outside meant re-deriving in
   CSS what iro computes internally, and racing its re-renders to do it. The
   file is now patched directly. MPL-2.0 permits this — it requires the
   modifications be *disclosed*, not avoided — so they are listed below and the
   banner stays. Keep patches marked `@creg` so they can be found and re-applied
   across an upstream re-sync.

### It is NOT pristine -- the local modifications

**This matters and was nearly missed.** The tilecraft copy carries a local patch
that sits *outside* the copyright banner and is easy to read past:

```js
let iroContainerScale = function () { return 1; };   // line 7
```

...plus three call sites (`var scale = iroContainerScale(props.id);` at roughly
lines 812, 976 and 1046). It exists so a host can tell iro.js that its container
is CSS-`scale`d, which iro cannot otherwise detect -- tilecraft overrides the
global from its own `color-picker.js`.

**In this project it is inert.** Nothing assigns `iroContainerScale`, so it keeps
its `() => 1` default, and this panel is not CSS-scaled. It is recorded here
because MPL-2.0 requires modifications to be disclosed, and because a future
re-sync from pristine upstream would silently drop it -- which would matter to
anyone who later *does* scale the container.

The alternative was fetching a pristine v5.5.2, which buys a simpler licence note
at the cost of diverging from the copy tilecraft runs, so a shared fix would then
have two places to land. Keeping one shared copy and documenting the delta was
judged the better trade.

### Phase 10 modifications -- the pigment fork

Every one is marked `@creg` in the source. The widget draws a **subtractive**
paint model, so a surface must show the pigment the brush deposits:

```js
rybToRgbDisplay(hsvToRyb(h, s, v), additive)   // app/ui/ryb.js
```

| What | Where | Why |
|---|---|---|
| `IroColor.pigmentRgb()` / `pigmentCss()` | after the `IroColor` methods | The display adapter. Normalizes iro's degrees/percent and applies the contract above. |
| Sampled disc canvas | `iroRenderWheelCanvas()`, `iroWheelCanvasRef()`, and `IroWheel`'s render | Replaces the conic hue gradient + white radial + black value overlays. Those composite to an **HSV** disc; this picker's interior is not HSV. |
| Sampled slider/ring stops | `getSliderGradient()`, `iroHueGradient()` | The pigment path between two colours is *curved* through the cube, so two endpoints are right only at the ends. |
| Explicit handle fills | `IroWheel` / `IroBox` handle props | Were `color.hslString`, a second additive path, so a handle showed a different colour from the disc beneath it. |
| `iroAdditiveModel` global | line 13 | Lets the host tell iro which model (Natural/Digital) the paint is compositing with. |

**Reverted in Phase 10d**, and worth not re-doing: an earlier patch overrode
`IroColor.hsvToRgb` globally so every surface converted implicitly. It had no
matching inverse (`rgbToHsv` stayed additive), which left `color.rgb`,
`hexString` and `hslString` silently returning a different colour space than
their names promise. Surfaces now ask for pigment **by name**; the stock RGB/HSL
accessors mean what they say. Never route host synchronization through them —
`app/ui/color.js` reads and writes H, S, V, A only.

See `docs/COLOR-PICKER-PAINT-PARITY-SPEC.md`. Guarded by `npm run test:color`
(numeric, no browser) and `debug/phase10-probe.js` (rendered surfaces).

### Integration notes -- do not "simplify" these

**iro.js is RGB-native; this simulation is RYB.** The wheel emits HSV/RGB, and
`app/ui/color.js` reads **only H, S, V and A** out of it, as 0..1, into the app's
existing `brushColorHSVA`. It deliberately never reads `color.rgb`: that is the
colour of the *widget*, an RGB rendering of the chosen hue, not the *pigment*
that hue becomes once `hsvToRyb()` has run. Conflating the two is precisely the
section 3b mistake, and it produces a plausible-looking wrong picture with no
error anywhere. `debug/phase8-probe.js` checks the paint texture's raw RYB for
exactly this, and the check was sabotage-verified by making the control read
`color.rgb` -- a blue stroke came back grey.

**`color.set()` silently ignores a partial object.** It dispatches on a complete
model -- `{r,g,b}`, `{h,s,v}`, `{h,s,l}`, `{kelvin}` or a string -- and anything
else falls through every branch and does nothing at all. No throw, no warning. So
`color.set({ a: 0.25 })` is a no-op that reads exactly like the app ignoring its
own control; use `color.setChannel('hsva', 'a', 0.25)` or pass all four channels.
`ColorControl.setHSVA()` passes all four, which is why it is unaffected -- but the
first version of the Phase 8 probe hit this and lost two checks to it.

**Units differ on both sides.** iro reports hue in DEGREES (0..360) and
saturation/value in PERCENT (0..100); this app stores all four channels as 0..1.
Two separate conversion factors, because one shared factor would be silently
wrong for hue.

**The echo guard is load-bearing.** `setHSVA()` writes into the widget, which
makes iro emit `color:change`, which would write straight back -- returning a
slightly different value after iro's own rounding. `ColorControl.applying` blocks
that return trip. Without it the hue stripe and the wheel fight each other, and a
dragged stripe visibly sticks.

**Only the slot's WIDTH is styled.** iro.js takes a single `width` and derives the
wheel diameter, both sliders and the gaps from it, so `#color-picker-slot` sets no
height -- a fixed height would either clip the alpha slider or leave dead space,
and would have to be re-guessed at every breakpoint. `ColorControl` re-measures
from a `ResizeObserver`, so the breakpoint rules only change the width.

## The sliders fork that was NOT done

Section 5a of the extraction plan specified forking tilecraft's
`SlidersComponent` (`tilecraft/components.js`, 418 lines) into
`app/ui/sliders.js`, keeping `components.css` for "the vertical-range styling
with full vendor-prefix coverage". **Reading the source before writing the fork
showed the premise does not hold here**, and the item was dropped deliberately:

- It is a **vertical** component -- it positions with `thumb.style.bottom` and
  `bar.style.height`, over `<input type="range" orient="vertical">`. Every slider
  in this panel is horizontal, and the compact bar's size slider is explicitly a
  horizontal strip beside the hue stripe.
- The vendor-prefixed CSS that justified taking it is ~70 of its 268 lines and is
  entirely `input[type=range][orient=vertical]` selectors. Ported to horizontal it
  would be rewritten, not kept.
- The existing slider is 160 lines, already pointer-event based, already handles
  pointer capture and `touch-action`, and is device-tested (Phase 6 retest:
  tablet 5/5 with finger and stylus).

So the fork would have been a vertical-to-horizontal port that discarded the
asset it was taken for, replacing working device-tested code. `slider.js` was
instead **moved** to `app/ui/sliders.js` unchanged, and `buttons.js` to
`app/ui/buttons.js`, so the whole UI now lives under `app/ui/`.

**The one real gap this leaves.** tilecraft's component is built on a native
`<input type="range">` and therefore gets keyboard and screen-reader support for
free; ours is a `<div>` with pointer handlers and has neither. That is a genuine
accessibility gap and a reasonable future task -- but it is an argument for adding
`role="slider"` and arrow-key handling, not for importing a vertical component.
