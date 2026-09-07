# Handoff — Phase 2 verified, one device open

Written 2026-09-07. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**. **Phases 0, 1 and 2 are done and
device-verified**, with one device failing — see the next section, which is the
most important thing in this file.

```
ad4c3e3  Add a float-blend probe to the device diagnostics
05299c8  Update the plan and handoff for the end of Phase 2
19ef834  Turn devicePixelRatio on, with a render-target memory budget
fe6f42f  Express the CSS-authored UI metrics in screen pixels
7dc05bd  Introduce the Viewport module, with DPR still off
a5eb6ac  Update the handoff and the 3a table for the end of Phase 1
85292c9  Gate the per-frame texture readback probe behind debug.textureProbe
43e7d6d  Gate the live bristle preview behind debug.brushViewer
57f033e  Extract the painting-rect outline into its own module
599c125  Amend §3a: the debug work is decomposition, not removal
142567a  Introduce the engine.debug flag object and ?debug= parsing
7f5176d  Record why the +/-5000 depth range could not be resolved
1355353  Build the main projection matrix in one place
7b48c01  Release the canvas-sized textures before rebuilding them on resize
43681b8  Hoist save() out of the per-frame update loop
```

Working tree clean apart from `docs/image.png` (untracked, not from this work).
Golden images: **12/12 pass** on both the source and dist paths.

### Device verification results (user, 2026-09-07)

| Device | Result |
|---|---|
| Samsung A56 | **Good** — Phase 2 works, DPR on |
| Samsung Galaxy Tab S9 | **Good** |
| iPhone 14 | **Fails — canvas stays white.** See below |

Phase 2's DPR change and the 1 GB render-target budget are therefore validated
on real Android hardware. The budget was never hit on those devices.

## The iPhone 14 failure — start here

**Symptom, as reported.** The brush moves correctly. The bristles orient
correctly. The debug view shows them touching the canvas. **The canvas stays
white and clean.** No error, no crash.

That combination is precise and it rules a lot out. The brush simulation, the
pointer path, the coordinate transforms and the projection are all working —
you can see them working. What fails is the step that turns bristle contact
into pigment: **the splat**.

### The leading hypothesis, and why

`Simulator.splat()` (simulator.js:540-575) enables blending —

```js
.enable(wgl.BLEND)
.blendEquation(wgl.FUNC_ADD)
.blendFuncSeparate(wgl.SRC_ALPHA, wgl.ONE_MINUS_SRC_ALPHA, wgl.ONE, wgl.ONE)
```

— and renders into `paintTexture`, which is **always `gl.FLOAT`**
(simulator.js:94). That is not true of the other targets: velocity, divergence
and pressure all go through `simulationTextureType`, which prefers half-float
and falls back to float (simulator.js:25-27). `paintTexture` is the one
resolution-sized target with no fallback.

Blending into a floating-point render target is gated by **`EXT_float_blend`**.
The app **never requests it and never checks for it** — the only mention in the
tree is in `debug/gpu-profiles.js`, in a list of extensions to deny. An
implementation without it is entitled to drop the draw, and dropping it
silently is exactly the reported symptom.

`hasFloatTextureSupport()` does not catch this. It checks that a float texture
is *renderable* (`canRenderToTexture`), which is a different question from
whether it can be *blended into*. So the app passes its own gate, initialises
fully, runs its physics — and deposits nothing.

This is a hypothesis with strong circumstantial support, **not a confirmed
diagnosis.** It has not been observed on the device.

### What to do first — one measurement, no code change

`?diag=1` now answers this directly. Open on the iPhone:

```
http://<host>:8099/index.html?diag=1
```

Two new rows:

- **`EXT_float_blend`** — whether the extension is advertised.
- **`blend into FLOAT target`** — the decisive one. It clears a 1×1 float
  target, draws white at alpha 0.5 with exactly the blend state `splat()` uses,
  reads back, and expects 0.5. On FAIL it prints *"splatting cannot deposit
  paint on this device"*.

The probe was sabotage-verified: it reads 0.5 and passes normally, and reads
1.0 and fails when blending is suppressed. It can fail, so a pass means
something.

**If it reports FAIL**, the hypothesis is confirmed and the fix is a design
choice (below). **If it reports PASS**, the hypothesis is wrong and the cause
is elsewhere — see "If the blend probe passes".

### If the blend probe FAILS — the options

None of these is obviously right; it is a real design decision.

1. **Make `paintTexture` half-float where full float will not blend.** The
   smallest change, and it follows the precedent already in the file:
   `simulationTextureType` exists for exactly this reason. Risk: half-float has
   ~11 bits of mantissa, and pigment accumulates over many splats, so banding
   or drift in long strokes is plausible. Needs a golden run and a real look.
2. **Splat without blending — read, combine in the shader, write.** Removes the
   dependency entirely and keeps full float precision. Costs a ping-pong target
   and a pass. This is the most robust and the most work.
3. **Request `EXT_float_blend` explicitly and fail loudly when absent.** Not a
   fix, but honest: the "float textures unsupported" page already exists for
   devices that cannot run the app. Worth doing regardless of which fix is
   chosen, so the failure stops being silent.

Whichever is chosen, **option 3's honesty belongs in it** — the current
behaviour of looking healthy while painting nothing is the worst part of this
bug, and it cost this session's diagnosis time even with the symptom described
precisely.

### If the blend probe PASSES

The hypothesis is wrong. Next candidates, roughly in order:

- **Read back `paintTexture` directly on the device** and see whether it is
  actually empty, or whether it holds pigment that the *render* path is then
  failing to show. The golden harness's `readPaintTexture()`
  (debug/golden-harness.js) is the code to borrow. This splits the problem in
  half and is the cheapest next step.
- **`Z_THRESHOLD` / precision.** Splatting only deposits where a bristle
  crosses `Z_THRESHOLD * brushScale`. The debug view showing contact is a
  *visual* judgement; the shader's comparison is `highp` float. Check
  `highp fragment precision` in the diag panel — it is already reported.
- **The scissor rectangle.** `splat()` restricts drawing to `simulationArea`.
  If that computes empty or off-target on this device the draw is clipped away
  entirely, with no error.

## What Phase 2 delivered

`viewport.js` owns canvas sizing, `devicePixelRatio`, the Y-flip and all three
coordinate spaces: `eventToScreen`, `cssToScreen`, `screenToCss`,
`cssLengthToScreen`, `screenToPainting`, `paintingToSimulation`,
`screenToSimulation`.

All four open-coded Y-flips are gone. CSS-authored UI metrics go through the
viewport; `RESIZING_RADIUS` is renamed `RESIZING_RADIUS_CSS` so the unit is in
the name. `ColorPicker` carries one `scale` rather than a dozen converted
constants.

DPR is on, clamped to 2. `?dpr=1` restores the old behaviour; `?dpr=N` raises
the cap.

The golden harness gained a **DPR axis** — 6 entries to 12, keyed
`webgl{1,2}/dpr{1,2}/{scenario}`. The dpr1 hashes are byte-identical to the
Phase 0 baseline, so the old path demonstrably did not move.

**Turning DPR on uncovered an unbounded memory defect that predates it.**
Nothing clamped total render-target memory, only each dimension, and the app
holds 22 float RGBA targets at painting resolution (7 simulator buffers + 15
undo snapshots, 16 bytes a texel). A 1280×800 window at ratio 2 asks for
2969 MB and the driver drops the context. A 2560×1440 window at quality High
asks for 2.6 GB *today, with no DPR at all* — DPR only made it reachable on an
ordinary window. `getEffectiveResolutionScale()` now clamps to
`PaintState.maxRenderTargetBytes` (1 GB) and warns once per distinct clamp.

## Things a fresh session will otherwise get wrong

**`paintTexture` is the odd one out.** It is always `gl.FLOAT`; every other
resolution-sized simulator target can degrade to half-float. Any reasoning
about float support has to treat it separately.

**`hasFloatTextureSupport()` does not test blending.** Renderable ≠ blendable.
The app passes its own gate on a device where splatting cannot work.

**At ratio 1 the Phase 2 code is equivalent to the old by construction.** That
is why the DPR axis had to exist: without dpr2 rows every Phase 2 commit passes
while the whole feature is untested. A future feature that is off by default
needs the same treatment.

**An identical hash across different scenarios means nothing was drawn**, not
that the renderer is stable. That is how the harness's own coordinate bug was
caught.

**The harness had the very bug Viewport exists to prevent** —
`paintingFractionToClient` mixed screen pixels into a CSS-pixel result.
Invisible while the units were equal; at ratio 2 it aimed every stroke at twice
its intended offset.

**Budget arithmetic was wrong by 4× on the first attempt** — 4 bytes a texel
instead of 16, and the 15 undo snapshots ignored entirely. Recompute from
`BYTES_PER_TEXEL` and `SIMULATION_TARGETS + HISTORY_SIZE`, never from memory.

**A time-driven scripted stroke is not a measurement.** Painted-texel counts
over identical code returned 76080, 99735 and 77917. Fine for "did any paint
land"; useless for regressions.

Still true from earlier phases: the RYB colour model is protected;
`hsvToRgb`/`hsvToRyb` being identical is not a bug; hue maps onto RYB channels
(`0.333` yellow, `0.667` blue); bristles need settling frames after
pointer-down; splatting is alpha-blended, not additive (**which is precisely
what the iPhone cannot do**); debug features are on by default and their flags
are decomposition, not a visibility switch; the ±5000 depth range is unresolved
because the harness cannot see the bristle overlay; `debug2.js` (751 lines) is
dead in the build; both `index.html` and `gulpfile.js` must list any new script.

## Phase 3 — after the iPhone question is settled

From the plan, §6: move the engine, unchanged, into `fluid-engine/`.

The last §2 defect belongs to that work: **`Simulator.splat()` takes a
screen-space `paintingRectangle`** and does the screen-to-simulation transform
itself (simulator.js:525-531). The engine knows about the screen and that must
be severed, or the engine is not UI-independent.
`viewport.screenToSimulation` was written for that seam and currently has no
caller.

Note the iPhone fix, whichever option is chosen, lands *inside* `splat()` — so
it is worth settling before Phase 3 moves that code, not after.

## Environment notes

- Playwright chromium is installed. Headless uses SwiftShader via ANGLE:
  a local regression tripwire only, and **its float-blend behaviour is not
  Apple's** — it passes the probe, which is why the iPhone needs a real check.
- Launch flags matter: `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. Wrong flags fail to compile shaders and report
  a clean result that means nothing.
- One-off probes go in `debug/` (not the scratchpad) because Node resolves
  `playwright` from the script's own path; delete them after use.
- The golden run is 12 checks now. Allow several minutes.
- A dev server was previously run on `192.168.1.224:8099` for device testing.

## Open items

- **iPhone 14 paints nothing** — the priority. Run `?diag=1` first.
- The 1 GB render-target budget is validated on Android, not on iOS.
- `Simulator.splat()` still takes screen-space coordinates.
- `debug2.js` — dead in the build; fold in or delete.
- The ±5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `docs/image.png` is untracked and not from this work.
