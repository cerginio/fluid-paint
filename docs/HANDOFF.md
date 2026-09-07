# Handoff — Phases 0-7 done; goldens need a decision

Written 2026-09-07. Read this, then `docs/FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**, working tree **dirty — Phase 7 is uncommitted**.
**Phases 0-7 are done.** The Phase 6 device retest with a stylus passed; its
three UX findings are **still open** and are not what Phase 7 addressed.

Golden images after Phase 7: **`paint` byte-identical on all 12** (the
simulation is untouched), **`screen` moved on all 12** because the panel is no
longer drawn into the canvas. The baseline was deliberately **not** re-recorded
— that decision is the first Open item. Phase 7's own behaviour is covered by
`debug/phase7-probe.js` at **30/30**. Shader lint passes, reporting
**23** shaders across two trees — one fewer than Phase 6, because
`app/shaders/panel.frag` went with the GL panel.

```
6d5e6d3  Phase 5: add the FluidEngine facade and split undo out of the engine
9ac1f3e  Give ColorPicker an accessor instead of an object and a property name
06a9860  Close the iPhone 14 bug: confirmed fixed on the device
1a7f944  Record Phase 4 in the plan and handoff
767820b  Phase 4: extract the painting render into fluid-engine/renderer.js
da591b8  Split the UI chrome shaders out of the engine tree
9cf9f2b  Phase 3: move the engine into fluid-engine/
e4a313c  Sever splat()'s screen dependency: take a brush-space rectangle
96f051f  Fix the iPhone 14 blank canvas: probe float blending, degrade to half-float
```

### Device verification results (user, 2026-09-07)

| Device | Result |
|---|---|
| Samsung A56 | **Good** — Phase 2 works, DPR on. Phase 6 retest: **3.7/5**, see UX notes |
| Samsung Galaxy Tab S9 | **Good** — Phase 6 retest with finger and stylus: **5/5** |
| iPhone 14 | **Was blank; fixed in `96f051f`, confirmed on the device — closed** |

### Current tree

```
fluid-paint/              <- git repo root
  fluid-engine/           <- the engine
    simulation.js         Simulator
    brush.js              Brush
    index.js              FluidEngine -- the public surface (Phase 5)
    renderer.js           PaintingRenderer (Phase 4)
    gl/wrappedgl.js       WrappedGL
    gl/glsl3.js
    shaders/              engine shaders only (19)
  app/
    shaders/              UI chrome shaders (5), split out in Phase 4
    ui/
      pointer-dispatcher.js   vendored (Phase 6), ONE local patch
  paint.js                the app: chrome, input, undo policy. No engine state.
  paint-setup.js          app constants (lighting left in P4, budget in P5)
  viewport.js             coordinate spaces + DPR
  common.js               the two shader manifests + loadShaderTrees()
  colorpicker.js slider.js buttons.js brushviewer.js rectangle.js utilities.js
  debug/                  harnesses and probes
  docs/
```

`d:/work/fluid-paint/fluid-engine/` — the empty directory **beside** the repo —
is a stale placeholder. Nothing went there. Do not put anything there.

## Phase 4 — what was done

### The renderer

`PaintingRenderer` in `fluid-engine/renderer.js` owns all six
`painting.vert`/`painting.frag` programs (four screen: RYB/RGB x normal/resizing;
two SAVE), the `output.frag` blit, and its own quad buffer.

**It does not own the target texture or framebuffer.** Those are per-call
arguments. That is the whole reason one implementation serves three callers:
`renderToTexture()` for the screen, `renderToPixels()` for save, and whatever a
second host wants in Phase 9. If you find yourself wanting to cache the target
in the constructor, that is the design going backwards.

`present()` is separate from `renderToTexture()` because the painting is redrawn
only when `needsRedraw`, but must be blitted **every** frame — the chrome is
drawn over it and is not part of the painting texture. Merging them silently
drops the chrome on still frames.

### Constants that moved, and the one that is shared

The lighting constants (`NORMAL_SCALE`, `ROUGHNESS`, `F0`, `SPECULAR_SCALE`,
`DIFFUSE_SCALE`, `LIGHT_DIRECTION`, `BACKGROUND_GRAY`) left `paint-setup.js` for
the renderer. They were only ever in the app because the draw call was.

**`RESIZING_FEATHER_SIZE` is the exception and the interesting one.** It reaches
two places that must agree: `painting.frag`'s RESIZING variant, which draws the
preview, and `simulator.resize()`, which feathers the paint texture when the
resize commits. If they ever disagreed the painting would visibly jump at the
moment the user let go of the handle. It is defined once in the renderer and
exposed as `PaintingRenderer.RESIZING_FEATHER_SIZE` so `paint.js` can pass the
same number to the simulator. Do not re-inline it on either side.

### A real bug found on the way

The screen and save paths open-coded the same seven material uniforms
separately, and **had already drifted** — the save path never set
`u_featherSize`. It happened not to matter (the SAVE variant does not declare
it), but that is luck, not design. `_applyMaterialUniforms()` now feeds both.

Setting a uniform a program does not declare is a safe no-op here: WrappedGL
builds `uniformLocations` from `ACTIVE_UNIFORMS`, so the lookup is `undefined`,
and a null location is ignored per the WebGL spec. The screen path was already
relying on this — it sets `u_featherSize` on the non-resizing programs too.

### The shader split

`panel.frag`, `picker.vert`/`picker.frag`, `shadow.frag` and `rectborder.frag`
moved to `app/shaders/`. **`fullscreen.vert` deliberately stayed engine-side**
even though the chrome uses it: the app hosts the engine, so an app -> engine
dependency is the right direction for that arrow. Do not "fix" this by copying
it into the app tree.

`loadTextFiles` applies **one** base path to every name, so two trees need two
calls. `SHADER_TREES` in `common.js` pairs each manifest with its path;
`loadShaderTrees()` merges the results into the single flat `shaderSources`
object every lookup already expects. **The ~24 keys are unchanged**, same as
Phase 3 — `shaderSources['shaders/panel.frag']` still resolves even though the
file now lives under `app/`. Only the base paths know where anything really is.

### The lint had the Phase 3 trap set for it again

`debug/lint-shaders.js` read one hardcoded shader directory, so after this split
it would have passed cleanly while checking **nothing** in `app/shaders/`. It
now walks both trees and **fails outright if it finds no shaders at all** — a
lint that checks nothing must not report OK. It prints the count (24) for
exactly that reason. This is the second time a path move has quietly disarmed
this script; assume a third.

### How the extraction was actually verified

Goldens 12/12 byte-identical, source and dist. But **the goldens cannot see
either path Phase 4 rewrote** — they never call `save()` and never enter the
resize preview. Passing goldens said nothing about the two hardest bits.

A throwaway probe (`debug/phase4-probe.js`, deleted after use per the `debug/`
convention) drove both directly on WebGL 1 and 2 and matched the pre-Phase-4
tree exactly:

| | WebGL 2 | WebGL 1 |
|---|---|---|
| save data-URL sha256 | `0fe8aca396d1` | `a4f3d1589650` |
| resize preview screen sum | 190394951 | 2522806384 |

**Sabotage-verified.** Moving `NORMAL_SCALE` 7.0 -> 7.5 shifted all four
numbers, so the match means something. If you rewrite either path again, write
the probe back — the numbers above are the expected values.

## Phase 5 — what was done

`fluid-engine/index.js` holds `FluidEngine`, composing `Simulator`, `Brush` and
`PaintingRenderer`. **`paint.js` has zero references to `this.simulator`,
`this.brush` or `this.renderer`** — that grep is the check that the boundary
actually holds.

### There is no `engine.simulator`, on purpose

A host that needs something the API does not offer is a finding about the API,
not a licence to reach past it. The golden harness was the first test of that
rule: it read `painter.simulator.paintTexture` to hash the simulation, which is
a legitimate need, so the engine grew `readPaintTexture()` rather than the
harness growing a back door. Expect Phase 9's second host to find more; add
methods, do not add an escape hatch.

### Undo, split

The ring buffer, `HISTORY_SIZE`, and when to rotate stay in `paint.js` —
history depth is a product decision. `engine.saveSnapshot()` /
`restoreSnapshot()` do the pixels, and **`engine.createSnapshot()` does the
allocation**. That last one matters: the texture must match the paint texture
type the capability probe chose, so a host that allocated its own `gl.FLOAT`
snapshot would work everywhere except the devices the half-float fallback
exists for, and would fail at *undo* rather than at startup.

`applySnapshot()` still restores the painting rectangle and the quality button
in the app, because those are app state; the snapshot's `paintingWidth`,
`paintingHeight` and `resolutionScale` are readable for exactly that.

### The bristle overlay

The case the plan flagged as fighting the facade: chrome that draws from engine
GL objects. It gets **one named `getBristleGeometry()`**, not four public
fields, so a second caller for those objects is visible in review. `BrushViewer`
takes the same geometry object instead of the `Brush`.

### Capabilities, and why `?diag=1` does not use them

`engine.capabilities` is public per the plan's honesty surface. The diag panel
**deliberately still reads the raw context**: it runs before `Paint` exists so
that it reports on a device where startup *fails*, which is the case it exists
for. Routing it through the engine would break it exactly when it is needed.

### The budget arithmetic moved, as statics

`FluidEngine.maxResolutionScaleForBudget()` and `estimateRenderTargetBytes()`
are **static because the host must ask before the engine exists** — the answer
is what sizes the engine. `BYTES_PER_TEXEL` and `SIMULATION_TARGETS` left
`paint-setup.js`; the app previously had to read `simulation.js` to know that
the second one is 7. Verified against the old formulas on four cases including
2520x1560 @ ratio 2 (1320 MB, correctly over the 1 GB budget) — identical.

### The bug the goldens caught

Moving `Brush`'s construction into the engine put it **before** `paint.js`'s
`Math.random()` for the initial hue. Under `?seed=`, `Brush`'s randoms texture
depends on how many draws came first, so all 12 hashes shifted — for a reason
completely invisible in the diff. Fixed by restoring the draw order, **not** by
re-recording the baseline. `paint.js` now draws the hue immediately before
constructing the engine, with a comment saying why that line cannot move.

If a future change shifts every hash at once, suspect RNG ordering before
suspecting the renderer.

## Phase 6 — what was done

Input now goes through the vendored `app/ui/pointer-dispatcher.js`. The
`onPointer*` handlers and the `activePointers` / `primaryPointerId` bookkeeping
are gone; `paint.js` subscribes to `panstart` / `pan` / `panend` / `cursormove`
/ `pan2` / `pan2end` / `pinch`. **The pen-pressure TODO is closed.**

Goldens are **12/12 byte-identical** to the Phase 0 baseline on both source and
dist — nothing was re-recorded. Shader lint still reports 24 shaders.

Full detail is in **`docs/UI-COMPONENTS.md`**. The parts that will bite:

### The dispatcher's event vocabulary is not what the plan said

There is no `pointerdown`/`pointerup` event. It is `panstart` / `pan` / `panend`
(plus `pan2`, `pinch`, `cursormove`). `panstart` carries **no `pressure`** — it
fires on pointerdown, before any move sample — so the first real pressure value
arrives with the first `pan`.

### The vendored file carries ONE patch, and losing it fails silently

`_move()` tested only whether `getCoalescedEvents` *exists*, not whether it
returned anything. A **synthetic** `PointerEvent` — `dispatchEvent`, which is
what the golden harness and every automated test uses — has the method but
returns an **empty list**, so `samples` was `[]` and **no `pan` was ever
emitted**. `panstart` and `panend` still fired, which is exactly what makes it
look like input works: the stroke begins, ends, and deposits nothing.

Marked `LOCAL PATCH` in the file. If it is ever re-synced from tilecraft, this
must be re-applied.

### Coordinates are adapted at the boundary, in two helpers

The dispatcher reports CSS-relative **Y-down** pixels scaled by its own reading
of the backing store; this app is **Y-up** and `Viewport` owns the DPR.
`_toScreen()` converts a point, `_deltaToScreen()` a delta. They are separate on
purpose: a delta takes the scale but no origin, and its Y flip is a sign change,
not a subtraction from the height. **Running a delta through `_toScreen()` would
add the viewport height to it every frame.**

### The brush position is read live, not from the `pan` event

`_syncBrushToPointer()` runs at the top of `update()`. The dispatcher defers
`pan` to its own RAF; the render loop's RAF is registered **first** (in
`_start`), and RAF callbacks run in registration order — so acting only on the
event left the brush **one frame behind the pointer, every frame**. Measured
directly: 11 `update()` frames ran at the stale position before the first `pan`
arrived.

That is not a cosmetic lag. `Brush.update()` derives bristle **speed** from the
delta it is handed, so a stale position changes how much paint is deposited —
it showed up as ~2% more paint in the same cells, same colour, same splat count
(34 vs 34). It looks exactly like noise. It is not.

### `pan2` and `pinch` both fire for EVERY two-finger gesture

The dispatcher only withholds a pinch whose scale is exactly 1. Two fingers
landing on the same frame make the **first frame's scale spike** — measured
~1.19 for a span that never changed — so a per-frame scale test flips the mode
to RESIZING and **a two-finger drag silently becomes a resize**.

`onGesturePinch()` therefore measures against the span the *gesture started
with* (`pinchStartSpan`), which cannot spike because it starts at exactly 1, and
gates on `PINCH_SCALE_DEADZONE`. It scales from `pinchStartRectangle`, not the
running rectangle, so the total ratio does not compound frame over frame.

### `getResizingSide()` was NOT deleted, though the plan said to

A pinch has a scale about a centroid but **no notion of which edge is being
dragged** — and that is what drives the asymmetric clamping in
`_resizePaintingTo()`, the `offsetX`/`offsetY` anchoring in `_commitResize()`,
and the resize **cursor** (`cursorForResizingSide`, paint.js:732). Deleting it
would have replaced edge-anchored mouse resizing with centroid scaling: a
different feature, not the same one. Pinch was added *alongside* it.

### Pen pressure: only pens are scaled

`_pressureScale()` returns 1 for anything that is not `pointerType === 'pen'`.
The Pointer Events spec reports a flat **`0.5` for devices with no pressure
hardware**, so scaling unconditionally would have silently **halved the brush
for every mouse and finger user** — a visible regression dressed as a feature.
Pens are clamped to `MIN_PRESSURE_SCALE` (0.15) because some report **0 on the
first sample** of a stroke, which would open the stroke with a zero-height brush.

Pressure is stored as `brushPressure`, a **multiplier**, not a computed height:
`brushScale` is changed independently by the size slider and the wheel, and a
stored height would silently keep the old size after either.

### How Phase 6 was actually verified

The goldens cannot see any of this — they drive a single-pointer mouse stroke
and never test pressure, gestures or hover. A throwaway probe
(`debug/phase6-probe2.js`, deleted after use) drove all four directly:

| Check | Expected |
|---|---|
| mouse at the spec's no-hardware `pressure: 0.5` | brush height **100** (unscaled) |
| pen 1.0 / 0.25 / 0 | 100 / 25 / **15** (floored, never 0) |
| two-finger drag, fingers +50 CSS x / +30 CSS y | `movedX +50`, `movedY -30`, mode never RESIZING |
| pinch, growing span | painting width grows |
| hover | brush moves, mode stays NONE |

**Sabotage-verified.** Inverting the X delta made `movedX` −50; dropping the
`pointerType !== 'pen'` guard made the mouse height 50. Both were caught, so the
passes mean something. If you rewrite either path, write the probe back.

### Phase 6 device retest — done, passed (user, 2026-09-07)

Retested on real hardware with a stylus. **The dispatcher works on real
digitizers**; nothing from the synthetic-event verification was contradicted.

| Device | Score | Notes |
|---|---|---|
| Galaxy Tab S9 | **5/5** | finger and stylus both; the best experience |
| iPhone 14 | 3.7/5 | see below |
| Samsung A56 | 3.7/5 | see below |

The user's summary: *"Overall above my expectations — I initially doubted this
machinery would fly on tablets and phones."* Phones score lower than the tablet
for reasons that are about screen size and pixel density, not about correctness.
Three concrete findings came out of it, and all three are Phase 7 work.

## Phase 7 — DONE (layout + floating panel)

The chrome is real DOM. The canvas draws the painting and the colour picker and
nothing else; the panel, its blur and its shadow are CSS.

### What was built, and the one place the plan was overruled

The plan said "responsive HTML layout: the canvas becomes one grid cell, chrome
becomes DOM around it". That was built first and then **deliberately changed**
after seeing it: a docked 300px column takes a third of a phone's width away
from the painting permanently, and the Phase 6 retest had just said screen area
is what separates the phones (3.7/5) from the tablet (5/5).

So the panel **floats over the canvas** instead of taking a column from it. The
canvas keeps the whole window at every breakpoint. This was the user's call,
made against a working docked implementation rather than as a guess.

The panel collapses to a compact bar that is the entire UI when collapsed:

```
[-----*------]  :::  [ |||||||||||||| ]
 brush size    grip     hue stripe
```

Those are the two things a painter changes mid-stroke. Drag the grip to move the
panel; **tap** it (movement under 3px) to collapse or expand.

### Files

- `app/layout.css` — new. The whole layout. `paint.css` is deleted.
- `app/ui/panel.js` — new. `ToolPanel`: drag, collapse, hue stripe. Knows
  nothing about the engine; reports through callbacks.
- `viewport.js` — sizes the canvas from a **container** via `ResizeObserver`,
  not from `window.innerWidth`. This is what finally kills the pinned-to-window
  assumption at the old paint.js:298.
- `index.html` — the canvas is created early (the capability probes need a GL
  context before the layout exists) and **moved into `#canvas-cell`** once the
  template is injected.
- `debug/browser-lock.js` — new, unrelated to the layout; see Test-machine load.

### What was deleted

`panelProgram`, `blurProgram`, `makeBlurShader()`, `pascalRow()`,
`app/shaders/panel.frag`, `PANEL_WIDTH/HEIGHT/BLUR_*`, `PANEL_SHADOW_ALPHA`, and
the two full-canvas RGBA scratch textures the blur ping-ponged through
(`tempCanvasTexture`, `blurredCanvasTexture`) — two thirds of the per-resize
texture allocation on every rotation.

**`shadowProgram` was NOT deleted, though the plan said to.** It has a second
caller: the *painting's* own drop shadow, which is presentation of the painting,
not panel chrome. Deleting it would have silently removed that too.

### Three traps this phase set, all found by measurement

**1. `Viewport`'s container must NOT default to `canvas.parentElement`.** It
looks harmless. A canvas appended straight to `<body>` then measures body's box,
whose height is content-driven — so it is sized *by* the canvas it is sizing.
Cost: all six dpr2 goldens drifted while all six dpr1 rows passed, because at
ratio 1 the two happened to agree. A container is now opt-in, and the
no-container path is byte-identical to pre-Phase-7.

**2. The golden harness had a `PANEL_WIDTH` reference of its own.** It refused
to start strokes under the panel rect, because the GL panel used to swallow
pointer-downs. Its own comment predicted Phase 7 would make it unnecessary, and
it did — the panel is a real element and the browser hit-tests it. Removing that
guard is what let the constants actually die.

**3. `needsRedraw = false` was inside `if (showPanel)`.** Hiding the panel left
the flag permanently set, so the painting re-rendered every frame. The
panel-hidden path silently cost the most work. Now cleared next to the render
that consumes it.

### Verification — 30/30 probe, and the goldens explained rather than re-recorded

`debug/phase7-probe.js` drives what the goldens structurally cannot see: the
canvas keeps the full window, the drag moves the panel by exactly the drag
distance, a drag does **not** toggle the collapse, a tap does, the bar's controls
stay usable when collapsed, the picker follows its DOM slot after a move, and a
slider drag deposits no paint while the same drag on the canvas does. **30/30.**

**Sabotage-verified twice, and once it failed to fail.** Breaking
`measureCssSize()` to ignore the container broke 7 checks; making the hue stripe
clobber saturation broke the hue-only check. But the "no growth loop" check
**could not be made to fail** — removing `min-width`, `overflow:hidden`,
`position:absolute` and the JS explicit CSS size all at once left it passing at
an unchanged 764, because the grid is window-bounded and the cell is never
content-sized. That check is labelled a weak tripwire in the probe. Do not read
its pass as proof those four guards are doing anything.

**Goldens: `paint` byte-identical on all 12, `screen` moved on all 12.** The
simulation is untouched. The screen hashes moved because `readScreen()` hashes
the painting rectangle, and the old GL panel (x=0..300, top 580px) **overlapped**
it — the painting starts at x=20. Measured directly rather than assumed. So the
drift is exactly "the panel is no longer painted into the canvas" and nothing
else.

**The baseline was NOT re-recorded.** That is a deliberate open decision, not an
oversight — see Open items.

### Test-machine load — a real incident, fixed in code

Running golden suites in the background and launching probes on top of them put
**12 headless Chromium processes at 91% CPU** on the dev machine; the mouse froze
for seconds. SwiftShader rasterises on the CPU, so each browser takes what it can
get.

`debug/browser-lock.js` now refuses to start a second concurrent Playwright run,
naming the pid holding the lock. Both runners take it. Chromium also runs with
`--renderer-process-limit=1` and a capped JS heap. Verified: the second run exits
without launching a browser, and the lock releases on exit, Ctrl+C and a crash
(it stores a pid, and a stale one is taken over).

Do not "optimise" this away by running suites in parallel. Hashes produced under
CPU starvation are not more correct, only more expensive.

## Answers to the questions asked at the end of Phase 7

### Will we add the iro.js colour picker, and when?

**Yes — it is Phase 8, and it is the next phase.** It was never dropped; the plan
has had it in §5a and §6 throughout, and the MPL-2.0 attribution obligation is
already recorded for `docs/UI-COMPONENTS.md`.

Phase 7 deliberately **prepared** for it rather than doing it early:

- `#color-picker-slot` in the markup is a reserved BOX, not a widget. The GL
  picker is drawn over that element's rect (`Paint._positionColorPicker`), so it
  already follows the layout instead of sitting at the old hardcoded
  `COLOR_PICKER_TOP = 523`.
- Swapping in iro.js is therefore "fill the slot and delete the GL draw", not
  "find where the picker lives".
- The hue stripe added in Phase 7 is **not** a replacement for it. It sets hue
  only, and is verified to leave saturation, value and alpha untouched — a
  compact mid-stroke control, not a colour editor.

The one rule for Phase 8: iro.js speaks HSVA, and the app's colour model is
**RYB** (protected, §3b). Convert at the boundary, exactly where `hsvToRyb`
already sits. Do not let an RGB picker's assumptions leak inward.

### Does the new UI panel work "through the API"?

**Two different questions, and the answers differ.**

*Does the panel go through `FluidEngine`'s public API?* **Yes.** `ToolPanel`
touches no engine state. It emits callbacks (`onHue`, `onLayoutChange`) and
`paint.js` turns those into engine calls. The Phase 5 boundary still holds:
`paint.js` has no references to `this.simulator`, `this.brush` or
`this.renderer` — that grep is still the check.

*Is the panel itself drivable through a public API?* **No, and it is not meant to
be.** `ToolPanel` is host UI, not engine surface. A second host (Phase 9) is
expected to bring its own controls and use none of this file. That is the point
of the split, not a gap in it.

### Can the API take brush commands — put a point, press, press-and-hold, move A to B?

**The primitives exist and are public. The stroke-level convenience API does
not, yet.**

What `FluidEngine` exposes today:

| Method | Meaning |
|---|---|
| `initializeBrush(x, y, height, scale)` | place the brush and **settle the bristles** — this is "press" |
| `positionBrush(x, y, height, scale)` | move the brush without depositing — advances bristle physics |
| `splat(paintingRect, {zThreshold, color, radius, velocityScale})` | deposit where bristles cross the painting |
| `frame()` | advance the fluid one step |

A stroke from A to B is therefore already expressible without any DOM event:
`initializeBrush(A)` → settle a few frames → per step `positionBrush(p)` +
`splat(...)` + `frame()`. **`debug/golden-harness.js` already does exactly this**
for its scripted scenarios, which is the proof it works — though it currently
drives synthetic pointer events rather than calling the engine directly.

Three things a caller must know, all load-bearing, all learned the hard way in
earlier phases:

1. **Bristles need settling frames after a press.** `initializeBrush()` places
   them; they still have to fall before any crosses `Z_THRESHOLD` and deposits.
   The harness settles 10 frames. A stroke that starts painting immediately lays
   nothing at all.
2. **Speed is derived from the delta handed to the brush**, not from time. So the
   spacing of the points you feed it *is* the stroke dynamics — feeding A and B
   directly paints differently from feeding 20 interpolated points between them.
   This is the same effect that made a one-frame-stale pointer read as ~2% extra
   paint in Phase 6.
3. **Coordinates are the host's painting space**, and the engine only requires
   that the rectangle passed to `splat()` agrees with the brush coordinates.

**For the tilecraft use case (tracing vector art in real time):** the model at
`D:/work/js-games/ua-dream/docs/spec/story-model-spec-min-render.json` maps onto
this well, and better than a generic path would. Its `Tile` already carries `g`
(group id — "tiles that form a logical stroke/path"), `b` (polyline break
marker), `gz` (close-path flag) and `s` (relative size, explicitly documented as
"brush-dependent scale factor, **or stylus pressure if applicable**"). That is
precisely the shape of a stroke command:

- one `g` group  → one `initializeBrush` + settle + a run of `positionBrush`/`splat`
- `b > 0`        → lift the brush and re-press (a new sub-stroke)
- `gz = 1`       → close back to the group's first tile
- `s`            → feeds the `height` argument, the same slot pen pressure uses
- `c`            → hex, so convert to HSVA then through `hsvToRyb` at the
  boundary; **do not** hand RGB to the simulator

So what is missing is not capability but a **named stroke API** — something like
`beginStroke/strokeTo/endStroke` with the settling and interpolation rules baked
in, so a caller cannot get them subtly wrong and see the result as noise. That is
a small, well-defined addition and it belongs with **Phase 9 ("prove reuse")**,
whose whole purpose is that a second host finding something missing is a finding
about the API. This is that finding, recorded before the host exists.

## UX findings from the Phase 6 device retest — STILL OPEN after Phase 7

These came from real-device use, not from a harness. They are **the** reason
phones score 3.7 where the tablet scores 5.

**Phase 7 fixed none of them, and that is worth stating plainly.** Phase 7 was
the layout: chrome out of the canvas, panel floating, canvas sized by its
container. It helps the *symptom* behind the scores (the painting no longer
loses width to chrome) but it does not touch the three causes below. Finding 1
in particular is still live: pinch zoom-out still destroys paint.

Carry them into whichever phase takes them. Finding 1 is the one that loses user
data, so it should not wait behind Phase 8's colour picker.

**1. Pinch zoom-out crops the image, because zoom and resize are the same
gesture.** Zoom **in** is good. Zoom **out** shrinks the painting *rectangle*,
and shrinking the rectangle destroys paint outside it — the user loses image
content to what they read as a view operation. This is inherited behaviour, not
a Phase 6 regression: `onGesturePinch()` was deliberately wired to
`_resizePaintingTo()` because that is what a pinch had to mean when the
rectangle was the only spatial state there was.

The fix is to **separate view zoom from canvas resize**, so a pinch changes only
what is on screen and nothing is ever lost. That means a view transform
(pan + zoom) that lives *between* the pointer and the painting rectangle —
`Viewport` is the natural owner, and `_toScreen()` / `_deltaToScreen()` in
`paint.js` are the two places it has to be applied. Resizing the canvas stays
available, but through the edge handles (`getResizingSide()`, kept in Phase 6
for exactly this reason), never through a pinch. Do not "fix" this by clamping
the pinch's lower bound — that hides the loss instead of removing it.

**2. Bristles stretch on transitions, on phones.** Both phones show the
bristles stretching during transitions; the tablet does not. Suspect the
bristle geometry being carried across a frame where the coordinate mapping
changes underneath it — a resize, a DPR change, or the zoom above — rather than
a simulation problem. Note this is a *different* symptom from the mobile GPU
bristle collapse fixed earlier (that one was `OES_texture_float_linear`); check
what changes between frames before reaching for shader maths again.

**3. Inertia on phones, without frame drops.** Explicitly *not* lag — the user
reports performance does not stutter, but input feels like it arrives late.
Given Phase 6 measured and fixed a one-frame staleness in the *brush* position
via `_syncBrushToPointer()`, the remaining latency is likely elsewhere in the
chain (chrome redraw, the dispatcher's RAF deferral for gestures, or simply
more simulation steps per CSS pixel at phone DPR). **Measure before tuning** —
"inertia" from a user is a report of feel, and the Phase 6 experience is that
the difference between a stale frame and noise is invisible without a probe.

### Why this is worth doing properly

The user's conclusion from the retest: **"I identified a number of valuable use
cases in our products if we implement the API properly."** The engine boundary
built in Phases 3-5 is what those use cases depend on, and the view/zoom
separation in finding 1 is the first real test of it — a second host will want
to zoom without owning the painting rectangle. Solve it in the engine's terms,
not with an app-local hack.

The same is true of the stroke API discussed above: `beginStroke/strokeTo/
endStroke` and a view transform are the two things a second host will ask for
first, and neither should be solved app-locally in `paint.js`.

### Also outstanding from Phase 5

The two structural extension points in §5 of the plan were deliberately
deferred: the `Renderer` interface, and a named pass list for
`Simulator.simulate()`. Neither blocks Phase 6, both are independently
verifiable, and `simulate()` is ~180 lines of fixed advect -> divergence ->
jacobi -> subtract sharing one scissored draw-state preamble — a real refactor
of that file, not of the boundary. Do it as its own change.

## Things a fresh session will otherwise get wrong

**`paintTexture` is the odd one out.** It is the only resolution-sized target
that is BLENDED into, which is why it needs `paintTextureType` (chosen by probe)
rather than `simulationTextureType`. Snapshot textures in `paint.js` must follow
it.

**`hasFloatTextureSupport()` does not test blending.** Renderable != blendable.
That gap is why the iPhone passed its own gate and painted nothing; the startup
gate now asks `canBlendIntoTexture()` too.

**A UA switch for the iPhone was considered and rejected.** It guesses which
devices are affected and is wrong in both directions — it misses non-Apple GPUs
with the same gap and penalises iPhones after WebKit ships a fix. The fix is a
capability probe (`WrappedGL.canBlendIntoTexture(type)`) that performs the exact
blend `splat()` uses and reads the result back. If someone proposes device
sniffing again, this is the argument.

**On WebGL 2, `OES_texture_half_float` is generally NOT exposed** even though
half-float is core, so asking for the extension object returns null on hardware
that supports half-float fine. Use `wgl.getHalfFloatType()`. Getting this wrong
silently disables the iPhone fallback on the exact context the iPhone reports.

**Capability probes must restore GL state.** `canBlendIntoTexture()` drives raw
GL behind `WrappedGL`'s state cache, so it resets viewport, blend equation,
blend func and clear colour to the tracked defaults before clearing the
dirty-set. Clearing the dirty-set alone would leak a 1x1 viewport into the next
draw.

**Construction order is load-bearing under `?seed=`.** `Brush`'s constructor
fills a randoms texture from `Math.random()`, so with the deterministic RNG
installed its bristles depend on how many draws happened before it. Phase 5 hit
this and it shifted all 12 hashes invisibly. If every hash moves at once,
suspect RNG ordering first.

**`?diag=1` reads the raw context on purpose, not `engine.capabilities`.** It
runs before `Paint` exists so it still reports on a device where startup fails.
"Unifying" it with the engine's capabilities would break the one case it is for.

**The goldens have blind spots, and they are where the risk is.** They never
call `save()`, never enter the resize preview, and cannot see the bristle
overlay. A change confined to those paths passes 12/12 while being completely
untested. Write a probe; sabotage it to prove it can fail.

**An identical hash across different scenarios means nothing was drawn**, not
that the renderer is stable. That is how the harness's own coordinate bug was
caught.

**At ratio 1 the Phase 2 code is equivalent to the old by construction.** That
is why the DPR axis had to exist: without dpr2 rows every Phase 2 commit passes
while the whole feature is untested. A future feature that is off by default
needs the same treatment.

**A time-driven scripted stroke is not a measurement.** Painted-texel counts
over identical code returned 76080, 99735 and 77917. Fine for "did any paint
land"; useless for regressions.

**Budget arithmetic was wrong by 4x on the first attempt** — 4 bytes a texel
instead of 16, and the 15 undo snapshots ignored entirely. Recompute from
`BYTES_PER_TEXEL` and `SIMULATION_TARGETS + HISTORY_SIZE`, never from memory.

**A `typeof fn === 'function'` guard around a debug entry point hides a missing
script.** That is how `debug2.js` sat dead in the build while its self-test
appeared to run. If a probe matters, let it throw.

**A synthetic `PointerEvent` has `getCoalescedEvents` but it returns an EMPTY
list.** Any input code that trusts the method's existence emits nothing under
every automated test while looking fine by inspection. This is what the vendored
dispatcher's one local patch fixes, and the failure is silent: the gesture's
start and end events still fire.

**RAF callbacks run in registration order, and the render loop registers
first.** Anything that defers input to its own RAF is therefore a frame behind
the simulation unless the app reads it live. Because `Brush.update()` derives
bristle speed from the delta it is given, a one-frame-stale position changes
deposition, not just apparent latency — it reads as ~2% noise in the goldens.

**`pointerType` is not decoration.** The Pointer Events spec reports
`pressure: 0.5` for hardware with no pressure sensor, so any unconditional
`* pressure` halves the brush for every mouse user. Scale pens only.

Still true from earlier phases: the RYB colour model is protected;
`hsvToRgb`/`hsvToRyb` being identical is not a bug; hue maps onto RYB channels
(`0.333` yellow, `0.667` blue); bristles need settling frames after
pointer-down; splatting is alpha-blended, not additive (**which is precisely
what the iPhone cannot do at full float**); debug features are on by default and
their flags are decomposition, not a visibility switch; the +/-5000 depth range
is unresolved because the harness cannot see the bristle overlay; **both
`index.html` and `gulpfile.js` must list any new script**, and the gulpfile's
order matters because the project uses globals with no module system.

## Commands

```
npm run test:golden          12 checks, several minutes
npm run test:golden:dist     the same against dist/ (GOLDEN_ROOT=dist)
npm run test:golden:record   re-record the baseline (refuses to record failures)
npm run lint:shaders         FLOAT+LINEAR textures, shader precision, both trees
npm run build                gulp build into dist/
npm run dev                  build + serve
```

Useful query parameters: `?diag=1` (on-device capability panel), `?gpu=<profile>`
(`desktop`, `samsung-a56`, `samsung-a56-boots`, `iphone-14`, `mobile-worst`),
`?golden=basic|colorMix|wetBlend|all`, `?webgl=1`, `?dpr=N`, `?seed=N`,
`?selftest=1`, `?audit=1`, `?debug=-textureProbe`.

## Environment notes

- Playwright chromium is installed. Headless uses SwiftShader via ANGLE:
  a local regression tripwire only, and **its float-blend behaviour is not
  Apple's** — it passes the probe, which is why the iPhone needs a real check.
- Launch flags matter: `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. Wrong flags fail to compile shaders and report
  a clean result that means nothing.
- One-off probes go in `debug/` (not the scratchpad) because Node resolves
  `playwright` from the script's own path; delete them after use.
- A dev server was previously run on `192.168.1.224:8099` for device testing.

## Open items

- ~~Phase 6 device retest with a stylus~~ — **done, 2026-09-07. It passed.**
  Tablet 5/5 with finger and stylus; phones 3.7/5. The pressure curve was not
  reported as top-heavy, so leave it linear until someone says otherwise.
- **The golden baseline needs a decision — the blocking one.** After Phase 7 all
  12 `screen` hashes moved while all 12 `paint` hashes stayed byte-identical.
  The cause is measured, not assumed: `readScreen()` hashes the painting
  rectangle, which starts at x=20, and the old GL panel covered x=0..300. So the
  drift is exactly the removed chrome. Re-recording is defensible **and has not
  been done**, because re-recording is the one move that would also hide an
  unrelated regression riding along in the same change. Decide, then either
  `npm run test:golden:record` or narrow `readScreen()` to a region the chrome
  never touched.
- **Pinch zoom-out crops the image** — still open, unchanged by Phase 7. Zoom and
  canvas resize are the same gesture, so zooming out destroys paint. Separate
  view zoom from the painting rectangle; see UX finding 1. This one loses user
  data and should not wait behind Phase 8.
- **Bristles stretch on transitions, phones only** — still open. UX finding 2.
  Not the old `OES_texture_float_linear` collapse; suspect the coordinate
  mapping changing under carried-over geometry.
- **Perceived inertia on phones with no frame drops** — still open. UX finding 3.
  Measure it with a probe before tuning anything.
- **Repeated taps produce identical bristle stamps** — now **Phase 8a** in the
  plan. `docs/bug-reports/non-random-wristles-brush-hits.png` shows a page of
  taps in one colour where every stamp is the same star, only translated. Cause
  read from the code: `Brush`'s randoms texture is filled once in the
  constructor and `setbristles.frag` lays the bristles out with a fixed
  sunflower formula, so `BRISTLE_JITTER` is the *same* jitter every press. Fix
  is a per-press rotation/offset seeded from the engine's seedable RNG — not
  `Math.random()`, or `?seed=` reproducibility dies. A real brush is not spun
  between strokes, so keep it small.
- **A named stroke API (`beginStroke`/`strokeTo`/`endStroke`)** — now
  **Phase 9a** in the plan. The primitives are public and sufficient today, but
  the settling and point-spacing rules are a caller's to get wrong silently.
  Wanted for the tilecraft tracing use case; see the Phase 7 answers above and
  `docs/api-usecases.md`. Interacts with 8a: the per-press re-seed belongs
  inside `beginStroke()`.
- The two Phase 5 extension points (Renderer interface, `simulate()` pass list)
  are deferred, not dropped. Neither blocks Phase 8.
- ~~Re-test the iPhone 14~~ — **done, 2026-09-07. It paints.** No banding
  reported in long strokes, and `readPaintTexture()`'s `gl.FLOAT` read against
  a half-float target is accepted by WebKit's driver. See
  `docs/DEVICE-VERIFICATION.md`.
- The 1 GB render-target budget is validated on Android, not on iOS.
- The +/-5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `viewport.screenToSimulation` still has no caller.
- `simulator.md` is misnamed: it is not simulator documentation but a saved
  `runWebGLSelfTest()` output dump from an Adreno 642L. That function went with
  `debug2.js`, so the file is an orphaned artifact. Keep it as a device record
  under a better name, or delete it.
- `docs/image.png` / `docs/image-ui.png` are untracked device screenshots;
  `image.png` is the `?diag=1` report that confirmed the iPhone diagnosis.
