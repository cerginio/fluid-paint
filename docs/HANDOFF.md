# Handoff — Phases 0-6 done, device retest owed

Written 2026-09-07. Read this, then `docs/FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**, working tree **clean**. **Phases 0-6 are done**,
but Phase 6 owes a **device retest with a stylus** — see below.

Golden images: **12/12 pass** on both the source and dist paths, with hashes
**byte-identical** to the Phase 0 baseline. Shader lint passes, now reporting
24 shaders across two trees.

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
| Samsung A56 | **Good** — Phase 2 works, DPR on |
| Samsung Galaxy Tab S9 | **Good** |
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

### Still owed on Phase 6

**Device retest on the A56 and the Galaxy Tab S9, with a stylus.** Everything
above was verified against headless SwiftShader with synthetic events. Synthetic
input is precisely what the vendored file got wrong, and no amount of it proves
a real digitizer behaves the same. Pressure curve feel in particular is
unverified on real hardware.

## Phase 7 — next

Per the plan, the responsive HTML layout. Note Phase 6 landed input underneath
the existing canvas-drawn chrome deliberately, so that chrome is still there and
still drawn by GL.

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

- **Phase 6 device retest — the A56 and the Galaxy Tab S9, with a stylus.**
  The blocking one. Everything in Phase 6 was verified against headless
  SwiftShader with **synthetic** pointer events, and synthetic input is exactly
  what the vendored dispatcher got wrong. Confirm: a one-finger stroke paints,
  two-finger drag pans without resizing, pinch resizes, and stylus pressure
  visibly varies stroke width. The pressure curve is linear and its feel is
  unvalidated on real hardware — if it reads top-heavy, that is a tuning
  question, not a bug (see the nonlinear-curve option in the Phase 6 notes).
- The two Phase 5 extension points (Renderer interface, `simulate()` pass list)
  are deferred, not dropped. Neither blocks Phase 7.
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
