# Handoff — state after Phase 1

Written 2026-09-07 so the next session can start on Phase 2 without re-deriving
anything. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**. **Phases 0 and 1 are done.** Phase 2 is next and
has not been started.

```
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
Every commit above was verified with `npm run test:golden`; the ones that touch
the build were also checked with `npm run test:golden:dist`. No baseline was
re-recorded — the hashes are the same as they were after Phase 0.

## The one decision that changed the plan

§3a called the debug instrumentation "sediment cleared for removal", with each
item demoted behind a flag **defaulting to off**. That reading was wrong, and
the first item proved it: the painting-rect outline is switched on today and
visibly drawn, and turning it off moved `screenHash` 6/6.

**The author's decision: every debug feature stays ON by default.** The problem
was never that they run — it is that they were entangled with `Paint`, which is
a drag on extracting the engine and defining its API. So the flag work is
**architectural decomposition, not visibility control**. §3a has been rewritten
to say this.

Two consequences worth carrying forward:

1. Phase 1's "golden images must not move" rule applies in its strict original
   form. A moved hash means the decomposition changed behaviour and the commit
   is wrong.
2. Because defaults are on, `?debug=` had to express both directions. It takes
   `-flag` / `!flag`, `none`|`off`, `all`|`on`, and `only:flag`.

## What Phase 1 delivered

**Three cheap fixes.**

- `save()` is a method, not a ~60-line closure rebuilt 60×/second.
- `onResize` deletes the three canvas-sized textures before rebuilding them.
  Measured: 18 leaked over 6 resizes before, 0 after.
- The ortho matrix is built in one place, `rebuildProjectionMatrix()`. The
  constructor's copy was dead — startup calls `onResize()` right after, which
  overwrote it.

**The flag mechanism**, in `debug/debug-flags.js`. Current flags, all default
on: `paintingRect`, `brushViewer`, `textureProbe`.

**Three items decomposed**, one per commit, each with its off path measured in
a real page rather than assumed:

| Flag | What turning it off actually saves |
|---|---|
| `paintingRect` | Module never constructed, 1 fewer GL program (29 to 28) |
| `brushViewer` | Object and its per-frame draw. **No allocation saved** — it borrows Paint's `brushProgram` and holds only matrices |
| `textureProbe` | Per stroke: 137 `readPixels` and 548 `getParameter` calls, down to 0 |

`textureProbe` is the one that mattered. `brush.js:535` called `debugTexture()`
on every simulation step unconditionally, and that is a 256×256 GPU-to-CPU sync
plus four pipeline stalls, in the hot loop.

## Things a fresh session will otherwise get wrong

**Measure the off path during a stroke, not at idle.** The first `textureProbe`
measurement showed `readPixels=0` both with and without the flag and looked
like the probe was free. It is not — `brush.js` only simulates while painting.
A scripted stroke was needed before the number meant anything. Any future
measurement of simulation-path work has the same trap.

**The golden harness cannot see the bristle overlay.** The projection matrix
feeds exactly one draw, which renders only mid-stroke and only to the screen,
never to the paint texture — and the scenarios capture after the stroke ends.
Verified by sabotage: ±1 moved nothing, and so did ±0.0001, a range that must
clip every bristle. **This is why the ±5000 depth range is still unresolved and
untouched.** Settling it needs a mid-stroke golden scenario or manual device
verification. A baseline that cannot fail is not evidence.

**`debug2.js` (751 lines) is not loaded by any page** — not in `index.html`,
not in the gulpfile's bundle list. It is dead in the build. Left alone this
session because deleting 751 lines is not a decision to make silently; §3a now
records the choice as open.

**Two script lists, not one.** `index.html` and `gulpfile.js` each enumerate
the scripts. A new file must be added to both, or the source path works and the
bundle silently does not. `npm run test:golden:dist` is what catches this.

**Watch backticks and apostrophes in shell heredocs.** Editing the plan through
a `python -c "..."` double-quoted string let the shell eat every backtick in
the markdown table rows, and the replacement silently no-opped. Use a quoted
heredoc for anything containing backticks, or the Write tool for prose.

Everything from the Phase 0 handoff still applies and is not repeated here: the
RYB colour model is protected; `hsvToRgb`/`hsvToRyb` being identical is not a
bug; hue maps onto RYB channels (`0.333` yellow, `0.667` blue); the UI panel
swallows strokes via `desiredInteractionMode`; bristles need settling frames
after pointer-down; splatting is alpha-blended, not additive.

## Phase 2 — what to do next

From the plan, §6. Nothing here has been started.

- Introduce `Viewport`: owns canvas sizing, `devicePixelRatio`, the Y-flip and
  all three coordinate spaces, with explicit conversions (`screenToPainting`,
  `paintingToSimulation`, ...).
- Replace all four open-coded Y-flips and every ad-hoc scale with calls into it.
- **DPR is turned on here.**

Phase 2 is the one phase expected to move hashes **on purpose**. Re-record then,
and say in the commit which moved and why. Re-recording to silence an
unexplained drift defeats the baseline.

`rebuildProjectionMatrix()` is the natural first thing for `Viewport` to
absorb — it already is the single place the projection is built.

## Environment notes

- Playwright chromium is installed. Headless uses SwiftShader via ANGLE, so
  hashes are a local regression tripwire only, not comparable to a real GPU.
- Browser launch flags matter: `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. A throwaway probe written with the wrong flags
  failed to compile shaders and reported a clean result that meant nothing.
- One-off probes were written into `debug/` (not the scratchpad) because Node
  resolves `playwright` from the script's own path, then deleted after use.
- Device verification stays manual: `docs/DEVICE-VERIFICATION.md`.

## Open items

- `debug2.js` — dead in the build; fold in or delete.
- The ±5000 depth range — unresolved, see above.
- `docs/image.png` is untracked and not from this work.
