# Vendored UI components

What was vendored, from where, at what version, and what was changed.

Started in Phase 6 with the pointer dispatcher. The rest of the inventory
(`iro.js`, the sliders fork) arrives with Phases 7-8; the licence notes for
`iro.js` in particular are a Phase 10 deliverable per the extraction plan.

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
spike because it starts at exactly 1, and gates on `PINCH_SCALE_DEADZONE`. The
resize scales from `pinchStartRectangle` rather than the running rectangle so
the total ratio does not compound frame over frame.

**`getResizingSide()` was NOT deleted**, though the extraction plan called for
it. A pinch has a scale about a centroid but no notion of *which* edge is being
dragged, and that is what drives the asymmetric clamping in
`_resizePaintingTo()`, the `offsetX`/`offsetY` anchoring in `_commitResize()`,
and the resize **cursor** (`cursorForResizingSide`). Deleting it would have
replaced edge-anchored mouse resizing with centroid scaling — a different
feature, not the same one. Pinch was added *alongside* it as the touch path.

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
