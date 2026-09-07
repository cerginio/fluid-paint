# Handoff — Phase 3 done, iPhone fixed but not re-tested

Written 2026-09-07. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**. **Phases 0-3 are done.** The iPhone 14 failure
is **diagnosed and fixed**; the fix is verified on a reproduction harness but
**not yet confirmed on the device itself** — that is the one open item.

Golden images: **12/12 pass** on both the source and dist paths, with hashes
byte-identical to the pre-fix baseline.

### Device verification results (user, 2026-09-07)

| Device | Result |
|---|---|
| Samsung A56 | **Good** — Phase 2 works, DPR on |
| Samsung Galaxy Tab S9 | **Good** |
| iPhone 14 | **Was blank; fixed, awaiting re-test** |

## The iPhone 14 failure — diagnosed and fixed

**The hypothesis in the previous handoff was correct.** The user ran `?diag=1`
on the device and it reported:

```
context                  WebGL 2
EXT_color_buffer_float   true
hasFloatTextureSupport() true
EXT_float_blend          false
blend into FLOAT target  FAIL (got 0.000, want 0.5)
  splatting cannot deposit paint on this device
```

So the app passed its own capability gate, initialised fully, ran its physics,
and deposited nothing — because `paintTexture` is alpha-blended into and Apple
does not expose `EXT_float_blend`. The draw was dropped silently.

### The fix

**Option 1 from the previous handoff: degrade `paintTexture` to half-float
where full float will not blend.** Chosen because half-float blending was
measured to work on the device class, and because it follows the precedent
`simulationTextureType` already set.

The choice is made by **capability probe, not by user-agent**:
`WrappedGL.canBlendIntoTexture(type)` performs the actual blend splat() uses
and reads the result back. Correct on untested devices, self-correcting when
WebKit ships the extension, and immune to UA spoofing. A UA switch was
considered and rejected — it guesses at which devices are affected and is wrong
in both directions.

Precedence, in `Simulator`:

1. float blends → `paintTexture` stays `gl.FLOAT` (every current desktop and
   Android device; hashes provably unmoved).
2. float does not blend, half-float does → degrade to half-float, warn on the
   console. This is the iPhone path.
3. neither blends → `canDepositPaint = false`, and **the startup gate in
   `index.html` now shows the unsupported page** instead of a healthy-looking
   blank canvas. That is option 3's honesty, folded in as the previous handoff
   asked.

`paint.js` snapshot textures follow `simulator.paintTextureType`, since a
snapshot holds a copy of `paintTexture` and a format mismatch would break undo.

### Why this is believed to work

A new GPU profile, **`?gpu=iphone-14`**, reproduces the device: it denies
`EXT_float_blend` and forces blended draws into 32-bit float targets to deposit
nothing (by masking colour writes for the duration of the draw), while leaving
half-float blending intact.

It was **sabotage-verified**. With the fallback disabled, the profile reproduces
the reported symptom exactly — `painted=0`, `maxAlpha=0`, no error, on both
WebGL 1 and 2 — while the desktop profile is unaffected. With the fallback in
place, all four combinations deposit paint. The harness can fail, so its passes
mean something.

`?diag=1` gained a **`blend into HALF_FLOAT target`** row, shown whenever the
float row fails, which is what distinguishes "the fallback will work here" from
"this device cannot paint at all".

### What has NOT been verified

**The fix has not been run on the iPhone 14.** Everything above is a
reproduction on desktop SwiftShader with blending suppressed by hand, which is
a model of the device and not the device. Re-test with `?diag=1` and a stroke.

Two things to watch for that the harness cannot see:

- **Banding or drift in long strokes.** Half-float has ~11 bits of mantissa and
  pigment accumulates over many splats. The reproduction showed a lower peak
  alpha under half-float (5.19 vs 8.42 on WebGL 2), which is the precision loss
  showing up in the accumulation — plausible but worth a real look.
- **`readPaintTexture()` reads with `gl.FLOAT`.** It worked against a
  half-float target under SwiftShader; a stricter driver may refuse the
  combination, which would affect the golden harness and undo, not painting.

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

**`paintTexture` is the odd one out.** It is the only resolution-sized target
that is BLENDED into, which is why it needs `paintTextureType` (chosen by
probe) rather than `simulationTextureType`. Snapshot textures in `paint.js`
must follow it.

**`hasFloatTextureSupport()` does not test blending.** Renderable ≠ blendable.
That gap is why the iPhone passed its own gate and painted nothing; the startup
gate now asks `canBlendIntoTexture()` as well.

**On WebGL 2, `OES_texture_half_float` is generally NOT exposed** even though
half-float is core, so asking for the extension object returns null on hardware
that supports half-float fine. Use `wgl.getHalfFloatType()`. Getting this wrong
silently disables the iPhone fallback on the exact context the iPhone reports.

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
what the iPhone cannot do at full float**); debug features are on by default and their flags
are decomposition, not a visibility switch; the ±5000 depth range is unresolved
because the harness cannot see the bristle overlay; `debug2.js` (751 lines) is
dead in the build; both `index.html` and `gulpfile.js` must list any new script.

## Phase 3 — done

The engine now lives in `fluid-engine/`: `simulation.js` (was `simulator.js`),
`brush.js`, `gl/wrappedgl.js`, `gl/glsl3.js` and `shaders/`. It is inside the
repo — the empty `fluid-engine/` sitting *beside* the repo at
`d:/work/fluid-paint/` is a placeholder and is not where anything went.

**The shader keys did not change, on purpose.** `loadTextFiles()` gained a
`basePath` that is prepended to fetch a file but is not part of the result key,
so every `shaderSources['shaders/...']` lookup still resolves and
`SHADER_BASE_PATH` in `common.js` is the only place that knows the real
location. The dist task mirrors the layout into `dist/fluid-engine/shaders`,
because a flat `dist/shaders` would 404 every fetch in the bundle.

**There was no `constants.js` to split.** The plan assumed one. The constants
are actually in `paint-setup.js` (app) and as file-local `const`s in the engine
files. Verified mechanically with comments stripped: zero app constants are used
by engine code and zero engine constants by app code. The one apparent
crossing, `BRUSH_HEIGHT` in `simulation.js`, is inside a comment.

`splat()` no longer names the screen: it takes `brushRectangle`, the painting
expressed in the brush's own coordinate space. The app still passes its
screen-space rectangle, because its brush lives in screen pixels — that is the
app's business, not the engine's.

`debug/lint-shaders.js` scanned only the repo root for `.js` files, so after the
move it would have checked nothing that creates textures — the same silent-pass
failure mode this project keeps hitting. It now walks `fluid-engine/` and
`fluid-engine/gl/` too, and reports repo-relative paths.

**The UI shaders moved with the rest.** `panel`, `picker`, `shadow` and
`rectborder` are chrome, not engine, and they now sit in
`fluid-engine/shaders/`. Splitting them is Phase 4's renderer extraction; doing
it during a move would mix relocation with redesign and the golden images could
not tell which had broken things.

Golden 12/12 on source and dist throughout, hashes byte-identical.

## Phase 4 — next

From the plan: extract the painting render out of `Paint.update()` into
`fluid-engine/renderer.js`. That is where the UI-shader split belongs, since the
chrome and the painting render are currently interleaved in one `update()` body.

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

- **Re-test the iPhone 14 with the fix** — the priority. `?diag=1` should now
  show `blend into HALF_FLOAT target PASS`, and a stroke should deposit paint.
  Look for banding in long strokes.
- The 1 GB render-target budget is validated on Android, not on iOS.
- The ±5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `simulator.md` is misnamed: it is not simulator documentation but a saved
  `runWebGLSelfTest()` output dump from an Adreno 642L device. That function
  went with `debug2.js`, so the file is an orphaned artifact. Keep as a device
  record under a better name, or delete.
- `docs/image.png` / `docs/image-ui.png` are untracked device screenshots;
  `image.png` is the `?diag=1` report that confirmed this diagnosis.
