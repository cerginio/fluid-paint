# Eraser review and replacement proposal

Status: proposed revision; no runtime changes. Reviewed against the current
engine and `ERASER-TOOL-SPEC.md`.

## Recommendation

Change the product contract from **cover with white** to **remove paint and
reveal the canvas**. Keep the circular cursor, shared size control, swept
stroke geometry, and one-gesture history operation.

The reported 2/5 result is a reason to revisit that contract before tuning
the white shader. The current checkout has no eraser implementation to inspect,
so the visual causes below are predictions from the spec and renderer, not
observations of the attempted implementation.

On an empty canvas, the result should match the existing unpainted surface.
Over a PNG, it should reveal the original image. A fully erased interior must
contain no pigment and no paint height. Later brush strokes paint there normally.
This deliberately replaces the old requirement that erasing over a PNG stays
white. If opaque white coverage is still required, it belongs to a separate
white-paint feature; it should not determine eraser behavior.

## Findings in the original spec

1. **The visual contract is the main problem** (`ERASER-TOOL-SPEC.md:9–27`).
   White coverage creates a patch unrelated to the underlying image. The
   renderer also lights paint using its height gradient, so adding height to
   make white opaque can introduce highlights or a raised boundary. A flat
   white overlay avoids that lighting but still looks pasted over the surface.

2. **No velocity injection does not guarantee a stationary result**
   (`ERASER-TOOL-SPEC.md:105–108`). `Simulator.simulate()` advects the paint
   texture wherever existing `splatAreas` are active. Old velocity can carry
   neighboring paint back into the erased area. A white background mask does
   not prevent that transport. Local velocity clearing alone would not give
   a permanent guarantee either.

3. **Partial ping-pong writes need a preservation rule**
   (`ERASER-TOOL-SPEC.md:92–93,120–123`). Drawing only a scissored capsule into
   `paintTextureTemp`, then swapping, exposes whatever was previously in the
   destination outside that rectangle. The current and temporary paint
   textures can differ after simulation. Every edit must preserve the current
   source outside its affected region.

4. **Repeated feather blending changes the edge with input frequency**
   (`ERASER-TOOL-SPEC.md:96–99`). Repeatedly applying a partial mask to the
   previous result compounds removal: ten applications of a 0.2 mask remove
   about 89%, not 20%. Swept capsules fix gaps, but not overlap accumulation.
   Slow movement, pauses, and repeated pointer samples can produce different
   edges unless coverage is defined for the whole gesture.

5. **The permanent white mask introduces unresolved layer semantics**
   (`ERASER-TOOL-SPEC.md:110–118`). The spec needs to say whether later paint
   covers it, clears it, or remains hidden beneath it. It adds persistent state
   to snapshots, resizing, export, and memory budgeting solely to enforce the
   problematic white requirement.

6. **History promises exceed the existing snapshot contract.** Engine snapshots
   save paint RGBA and geometry metadata, not velocity or simulation history.
   `Simulator.applyPaintTexture()` resets velocity. Promise exact restoration
   of stored paint, not resumption of the previous fluid trajectory.

## Replacement behavior

- The eraser removes paint at full strength in its interior. It ignores brush
  color, opacity, bristles, fluidity, and pen pressure.
- Start with a mostly firm circular footprint and a narrow smooth transition.
  Prototype a feather of 5% of radius, bounded to roughly 1–3 simulation texels
  and never greater than the radius. Tune this visually at different quality
  levels; these are starting values, not a validated optimum.
- A click is a dab; movement forms a continuous union of swept capsules.
  Holding still causes no additional removal within that gesture. A new
  gesture can further remove residual paint at an earlier feather edge.
- Keep the existing shared `brushScale` contract. Freeze diameter for an active
  gesture; size changes apply to the next gesture. The active cursor displays
  the frozen diameter so the preview remains truthful.
- Keep the DOM circle, but use contrasting outlines without a white interior
  tint. The user should see the actual surface while positioning the tool.
- Export keeps its existing flattened, opaque behavior. Removing paint is
  separate from adding transparent PNG export: `painting.frag` currently
  outputs alpha 1.

### Fluid behavior: predictable cleanup for v1

On the first effective eraser contact, save the pre-edit paint snapshot, then
stop current fluid motion without advancing extra settling frames:

- clear both velocity textures;
- empty `splatAreas`;
- prevent fluid steps and brush splats during the gesture;
- reset the live clock when returning to ordinary painting.

This freezes wet motion across the entire painting. It is an intentional UX
tradeoff, not a local physics solution. It avoids a hole refilling immediately
after release and fits the existing paint-only history model. New brush input
may activate simulation again and move paint into previously erased regions;
erasing creates no permanent protected region.

If preserving motion elsewhere is essential, prototype that separately. A
persistent exclusion mask would require defined transport boundaries and rules
for later repainting, beyond the scope of this small eraser.

## Engine implementation outline

Use a dedicated erase operation with begin/to/end guards, separate from bristle
splatting. Preserve the public Brush and replay contracts. Retain the original
spec's manual-input ownership, gesture precedence, endpoint flushing, pointer
cancellation, and build integration requirements.

1. **Capture an immutable paint baseline for the gesture.** Reuse the undo
   snapshot through an engine-owned interface if its lifetime is guaranteed;
   otherwise allocate one scratch baseline. Do not expose host-managed raw GL
   textures just for this operation.
2. **Accumulate temporary coverage.** For each segment, calculate a capsule
   mask and update `coverage = max(previousCoverage, segmentMask)`. Use a
   temporary ping-pong mask with a shader `max`, so the operation does not
   depend on float blending or a MAX-blend extension. This mask exists only
   during the gesture; it is not a new document layer or snapshot field.
3. **Remove material from the baseline:**

   ```glsl
   result = baselinePaint * (1.0 - coverage);
   ```

   Apply this to all four channels. RGB stores pigment parameters and alpha
   stores height; this is an interpolation toward the engine's empty material,
   not a conventional premultiplied-alpha eraser. Clearing only alpha leaves
   visible pigment on the no-background rendering path. Clearing only RGB
   leaves relief. At full coverage, write exact zero RGBA.
4. **Preserve pixels outside the edit.** Start with full-texture passes for
   correctness, writing unchanged source values outside the mask. If profiling
   justifies scissoring, copy the complete current source into the destination
   before the partial write, or establish and verify an equivalent preservation
   invariant. Apply this rule to mask ping-pong as well as paint ping-pong.
5. **Use stable coordinates.** Convert fragment texel centers back to painting
   world coordinates and measure distance there, against world-space endpoints
   and radius. This keeps circles circular when X/Y simulation scales differ.
   Handle coincident endpoints explicitly. Derive clipping bounds from that
   same transform. Do not use a naive Euclidean distance in normalized UVs.
6. **Finish cleanly.** Synchronize both paint buffers to the committed result,
   release temporary gesture state, and leave no active operation. Redo restores
   the committed paint snapshot rather than replaying pointer events. Reject
   conflicting resize/restore/clear operations or terminate the gesture through
   an explicit host path before invoking them.

The renderer should initially remain unchanged: zero material already selects
the unpainted surface or the PNG background. The narrow partial-coverage edge
still passes through pigment conversion and height lighting; it may show a
rim or color shift. Judge that prototype visually before accepting it. This
proposal removes the white patch but cannot promise attractive edge shading
without seeing it rendered.

## Validation before committing to the design

First build a small GPU prototype of material removal and gesture coverage.
Compare it with the attempted white eraser on dense dark paint, thin paint,
thick ridges, and a detailed imported PNG. Inspect taps, curved strokes, slow
and fast sweeps, overlapping segments, and repainting. Review the appearance
before spending time on the full toolbar integration.

Acceptance requires:

- Fully erased interiors match an untouched surface under the same background
  and lighting, including export; no white overlay or residual interior relief.
- Repeated identical samples and equivalent subdivision of a straight segment
  produce the same coverage within render-target precision.
- Distant paint remains unchanged after alternating eraser edits and simulation
  buffer swaps. No stale pixels reappear on the next brush stroke.
- Erased marks stay stable while idle after release. The documented global
  freeze is visible in a test with active wet paint elsewhere.
- Undo/redo restores exact stored paint and dimensions. No claim of restoring
  prior velocity. Cancellation and two-finger takeover terminate exactly once.
- Cursor footprint and stroke align across DPR, zoom, rotation, and quality
  changes. Test CSS diameter separately from canvas backing-store diameter.
- Existing shader lint, timing, and live-GPU checks pass alongside focused GPU
  checks for coverage, baseline preservation, background reveal, and history.
- Measure frame time and temporary texture memory on a mobile GPU before
  optimizing the full-frame reference implementation.

No runtime tests were run for this document-only review.
