# Handoff — state after Phase 2

Written 2026-09-07 so the next session can continue without re-deriving
anything. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**. **Phases 0, 1 and 2 are done in code.**

**Phase 2 is not finished until the device verification happens** — see "The
one thing outstanding" below. Phase 3 should not start before it.

```
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

## The one thing outstanding

**Manual device verification, per `docs/DEVICE-VERIFICATION.md`.** The user has
a Samsung A56 and a tablet, and previously confirmed the WebGL 2 dual path on
both.

What needs checking, in order of how likely it is to be wrong:

1. **Does it still run at all?** DPR is now on, so the phone allocates roughly
   four times the render-target memory it used to. `?dpr=1` is the escape hatch
   if it does not — that restores the old behaviour exactly.
2. **Is the 1 GB budget right?** It was chosen against SwiftShader's limits and
   arithmetic, not a real phone. If the A56 dies at 1 GB, lower
   `PaintState.maxRenderTargetBytes`; if it is comfortable, it can rise. Watch
   the console — the clamp warns once per distinct clamp, saying what was asked
   for and what it got.
3. **Is the painting actually sharper?** That is the point of the phase.
4. **Do the UI hit-targets still line up?** The panel, the colour picker and
   the edge-grab margins were all converted from CSS to screen pixels. A wrong
   conversion shows up as "the control is drawn here but responds over there".

## What Phase 2 delivered

`viewport.js` owns canvas sizing, `devicePixelRatio`, the Y-flip and all three
coordinate spaces: `eventToScreen`, `cssToScreen`, `screenToCss`,
`cssLengthToScreen`, `screenToPainting`, `paintingToSimulation`,
`screenToSimulation`.

All four open-coded Y-flips are gone. The CSS-authored UI metrics go through
the viewport; `RESIZING_RADIUS` is renamed `RESIZING_RADIUS_CSS` so the unit is
in the name. `ColorPicker` carries one `scale` rather than a dozen converted
constants.

DPR is on, clamped to 2. `?dpr=1` restores the old behaviour; `?dpr=N` raises
the cap.

**The golden harness gained a DPR axis** — 6 entries to 12, keyed
`webgl{1,2}/dpr{1,2}/{scenario}`. The dpr1 hashes are byte-identical to the
Phase 0 baseline, so the old path demonstrably did not move; the dpr2 rows are
new, simulating at 2220x1375 rather than 1860x1140.

## What turning DPR on uncovered

**An unbounded memory defect that predates DPR.** `maxPaintingWidth` clamps
each *dimension* against `MAX_TEXTURE_SIZE`, but nothing clamped total memory —
and the app holds **22 float RGBA render targets** at the painting resolution:
7 simulator buffers plus `HISTORY_SIZE` = 15 undo snapshots, at 16 bytes a
texel. A 1280x800 window at ratio 2 asks for 2969 MB, the driver answers
`GL_OUT_OF_MEMORY` and drops the context. That is a black canvas, not a slow
one.

**DPR did not create this.** A 2560x1440 window at quality High asks for 2.6 GB
today with no DPR at all. DPR only made it reachable on an ordinary window.

`getEffectiveResolutionScale()` clamps to `PaintState.maxRenderTargetBytes`
(1 GB) and warns once per distinct clamp. Per the user's decision the budget
covers **all** targets including the undo history: the painting keeps its size,
undo keeps its depth, and simulation fidelity is what degrades — the one of the
three that degrades gracefully.

## Things a fresh session will otherwise get wrong

**At ratio 1 the new code is equivalent to the old by construction.** This is
why the DPR axis had to be added to the harness: without dpr2 rows, every
Phase 2 commit passes 6/6 while the entire feature is untested. If a future
phase adds a mode that is off by default, it needs its own axis for the same
reason.

**The harness had the very bug the Viewport exists to prevent.**
`paintingFractionToClient` mixed screen pixels into a CSS-pixel result and its
panel guard compared the two units. Invisible while the units were equal;
at ratio 2 it aimed every stroke at twice its intended offset, so the strokes
deposited nothing and all three dpr2 scenarios returned an identical empty
`paintHash`. **An identical hash across different scenarios means nothing was
drawn, not that the renderer is stable.**

**A first attempt at the budget was wrong by 4x** — it counted 4 bytes a texel
instead of 16, and ignored the 15 undo snapshots entirely, so a "180 MB"
estimate was really 2.2 GB. If you touch the budget, recompute it from
`BYTES_PER_TEXEL` and `SIMULATION_TARGETS + HISTORY_SIZE` rather than trusting
a remembered figure.

**A time-driven scripted stroke is not a measurement.** Counting painted texels
over the same unchanged code returned 76080, 99735 and 77917 across three runs.
It is fine for "did any paint land"; it cannot detect a regression. The golden
hashes are what does that.

Everything from the earlier handoffs still applies: the RYB colour model is
protected; `hsvToRgb`/`hsvToRyb` being identical is not a bug; hue maps onto
RYB channels (`0.333` yellow, `0.667` blue); bristles need settling frames
after pointer-down; splatting is alpha-blended, not additive; debug features
are on by default and their flags are decomposition, not a visibility switch;
the ±5000 depth range is still unresolved because the harness cannot see the
bristle overlay; `debug2.js` (751 lines) is dead in the build; and both
`index.html` and `gulpfile.js` must list any new script.

## Phase 3 — what comes after the device check

From the plan, §6: move the engine, unchanged, into `fluid-engine/`.

The last §2 defect is still open and belongs to this work:
**`Simulator.splat()` takes a screen-space `paintingRectangle`** and does the
screen-to-simulation transform itself (simulator.js:525-531). The engine knows
about the screen, and that must be severed or the engine is not UI-independent.
`viewport.screenToSimulation` exists for exactly this and currently has no
caller — it was written for that seam.

## Environment notes

- Playwright chromium is installed. Headless uses SwiftShader via ANGLE, so
  hashes are a local regression tripwire only. Its memory limits are also not a
  phone's, which is why the budget needs a real device.
- Browser launch flags matter: `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. The wrong flags fail to compile shaders and
  report a clean result that means nothing.
- One-off probes go in `debug/` (not the scratchpad) because Node resolves
  `playwright` from the script's own path; delete them after use.
- The golden run is now twice as long (12 checks). Allow several minutes.

## Open items

- **Device verification for Phase 2** — the gate before Phase 3.
- The 1 GB render-target budget is unvalidated on real hardware.
- `Simulator.splat()` still takes screen-space coordinates.
- `debug2.js` — dead in the build; fold in or delete.
- The ±5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `docs/image.png` is untracked and not from this work.
