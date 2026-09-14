# Colour picker and paint parity repair

Status: implementation specification; not implemented.

## Outcome and scope

Make the colour disc, its handles, all colour sliders, the compact hue strip,
and the brush preview describe the pigment that the current paint engine will
deposit. Preserve the existing painting and mixing behaviour.

This specification supersedes the Phase 10c handoff's assertion that display
and paint can use different saturation/value mappings and still agree. The
repair is complete only when the actual paint boundary and rendered UI agree
away from the fully saturated, full-value rim.

The chosen compatibility policy is to preserve existing HSVA selections and
their deposited pigment. Consequently the repaired disc will have a dark-brown
centre at full value in Natural mode, and the existing value coordinate's zero
end will show white. These are properties of the existing selection mapping,
not display errors once the paint agrees. Do not retain a white centre or a
black zero endpoint by painting an unrelated RGB overlay over the disc.

A conventional white-centre, black-value picker is a separate selection-model
redesign. It requires changing the selection-to-pigment mapping consistently,
defining compatibility for stored colours, and addressing the Natural cube's
limited gamut. It is not part of this parity repair.

## Confirmed failure

Current paint path:

```text
brushColorHSVA -> common.js:hsvToRyb(h,s,v) -> engine.splat(color)
             -> pigment texture/mixing -> painting.frag:rybToRgb
```

Current display and brush-preview path:

```text
h,s -> hueToPigmentLoad -> rybToRgbDisplay -> multiply RGB by v
```

At h=0, using normalized coordinates and rounded 8-bit RGB:

| Selection | Current UI/preview | Required base colour from paint |
| --- | --- | --- |
| s=0, v=1 | (255,255,255) | (51,24,0) |
| s=1, v=0 | (0,0,0) | (255,255,255) |
| s=1, v=0.5 | (128,0,0) | (255,128,128) |
| s=0.5, v=1 | (255,128,128) | (172,38,32) |
| s=1, v=1 | (255,0,0) | (255,0,0) |

The third row explains the pink paint versus dark-red bristles in the report.
The first two explain the apparent black/white inversion. Passing rim checks
does not establish parity over the disc.

These are base colours, before lighting, paint thickness, background mixing,
and fluid transport. The picker is not expected to predict every lit pixel of
an evolving stroke.

## Authoritative colour contract

Use the existing conversion at both boundaries:

```js
const pigment = hsvToRyb(h, s, v);
const displayRgb = rybToRgbDisplay(pigment, additive);
```

Implement `hsvToPigmentRgb(h,s,v,additive)` as precisely that composition.
Remove `hueToPigmentLoad` if it has no other legitimate caller. Do not multiply
the converted RGB by value, add white, or invert RGB afterward.

Keep the existing normalized `brushColorHSVA` array and mutate it in place.
Only selection coordinates and alpha cross the picker-to-host boundary.
Never send display RGB back as pigment, and never derive the stored selection
by applying an RGB inverse to a pigment display colour.

Keep `common.js:hsvToRyb`, engine splatting, texture storage, mixing, and the
production painting shader unchanged. Use the existing helper rather than
copying its ramp into another UI function.

Natural mode uses the existing eight-corner trilinear cube. Digital mode uses
the actual shader branch, `[1-pigment[1], 1-pigment[0], 1-pigment[2]]`. Preserve
the channel swap. The UI must follow these implementations rather than infer
behaviour from the names "Natural", "Digital", or "RGB".

The cube's axes are numerically red, blue, yellow: `(1,0,0)` is red,
`(0,1,0)` is slate blue, and `(0,0,1)` is yellow. Correct contradictory comments
in touched code; do not swap channels to make the acronym read literally.

`(0,0,0)` is white colour data, not absence of paint: nonzero splat alpha can
deposit it as white paint. Pigment colour and deposited amount are separate.
The Natural cube has no pure-black corner; `(1,1,1)` is `(0.2,0.094,0)`.

## Iro integration

Retain Iro's geometry, input handling, active-colour state, and event plumbing.
Provide an explicit, instance-scoped display-colour callback/adapter for this
picker. Every custom paint UI surface calls that adapter with selection HSV;
the adapter normalizes degrees/percent to 0..1 and uses the contract above.

Restore standard RGB/HSL conversion semantics in Iro's colour object. The
current global `hsvToRgb` override has no matching inverse, and returning an
RGB string from `hslString` makes that getter misleading. Handles must request
their display fill explicitly instead of depending on those overrides.
Ordinary RGB/hex setters are not pigment inverses and must not be used for
host synchronization. Initialize and update this picker through HSV fields.

A focused patch in the existing local Iro fork may introduce the adapter and
custom surface rendering. Preserve its licence notices and document the patch.
Integrate rendering with Iro's lifecycle; do not repeatedly overwrite DOM
styles that its next render will replace. Remove the process-global model
callback when the instance adapter replaces it.

## Disc rendering

Replace the conic hue gradient plus white radial overlay plus black value
overlay with a sampled image of the actual mapping over the whole disc.
Use a Canvas 2D backing image or equivalent deterministic raster surface;
no image-generation model is involved.

For each interior pixel, derive hue and saturation with the same geometry
used by Iro's hit testing, including wheel angle, direction, centre, and radius.
Evaluate `display(h,s,currentValue,currentModel)` and write the resulting RGB.
Clip/antialias the circular boundary. Preserve handle positions and input
targets; the raster surface must not intercept pointer events.

Remove or disable `IroWheelSaturation` and `IroWheelLightness` overlays for this
picker. They cannot represent the nonlinear pigment conversion. Interpolation
between white and a rim colour is also insufficient for mixed-pigment hues.

Cache by value, model, dimensions, device pixel ratio, angle, and direction.
Hue/saturation handle movement alone does not require rebuilding the disc.
Coalesce value drags to at most one rebuild per animation frame. Rebuild when
the model or physical backing size changes, including device pixel ratio.
Use a bounded backing resolution if needed and verify pixel accuracy at the
supported picker sizes. Release rendering resources on teardown.

## Sliders, handles, strip, and preview

| Surface | Required rendering |
| --- | --- |
| Wheel and slider handles | Explicit adapter RGB at the selected HSV/model |
| Value slider | Sample `display(h,s,t,model)` over its full length |
| Saturation slider, if enabled | Sample `display(h,t,v,model)` |
| Hue slider, if enabled | Sample `display(t,s,v,model)` |
| Compact hue strip | Full hue reference at s=1,v=1; preserve its existing role |
| Alpha slider | Selected base RGB over checkerboard, varying UI opacity only |
| Brush preview | Same adapter base RGB for the current selection/model |

Render colour sliders as sampled strips (or sufficiently dense measured
gradient stops). Two endpoints alone do not generally reproduce trilinear
conversion along a path through the cube. Handle centres must agree with
the unoccluded underlying raster at their coordinates.

Keep the value coordinate and direction for compatibility; show white at t=0
and the actual pigment at t=1. If a visible label is added, use "Pigment level"
instead of promising RGB brightness. Do not rename the internal stored field
as part of this repair.

Alpha retains its current paint-amount mapping. The checkerboard is an opacity
affordance, not a prediction of wet-paint mixing. Do not modify pigment RGB
when alpha changes.

On a Natural/Digital toggle, refresh all surfaces and preview together while
preserving the exact stored HSVA. On host updates, resize, undo/restore, and
panel expansion, preserve the same agreement without synthetic colour-change
events or feedback loops.

## File-level implementation plan

1. `app/ui/ryb.js`: restore exact paint/display composition; retain cube parity
   guard; remove the divergent load mapping and misleading explanatory text.
2. `lib/iro.js`: add the instance display adapter and sampled surfaces; route
   handle fills explicitly; restore standard colour conversion accessors.
3. `app/ui/color.js`: configure the adapter and model invalidation; retain
   HSVA synchronization and teardown; replace stale global-gradient plumbing.
4. `paint.js` / `brushviewer.js`: ensure preview uses the shared display
   contract; correct comments claiming the current divergent formula is the
   paint path. Preserve the splat conversion and brush rendering geometry.
5. Compact strip implementation: use the shared hue-reference rendering and
   model invalidation. Audit all `cssPigment` and conversion consumers.
6. `debug/phase10-probe.js`: replace incorrect endpoint assumptions and extend
   coverage as below. Prefer a durable colour-parity test name/script rather
   than describing regression protection as disposable.
7. `docs/HANDOFF.md` and `docs/UI-COMPONENTS.md`: record the superseding contract
   and the actual local Iro changes. Clearly mark the Phase 10c claims obsolete.
8. If adding a script, list it in both `index.html` and `gulpfile.js` in the
   required dependency order. Verify the production bundle as well as source.

## Acceptance tests

### Independent numeric reference

Before implementing the repair, add failing tests for all five rows in the
table. Cover both model branches and a grid of hues every 15 degrees,
saturation `[0,0.25,0.5,0.75,1]`, and value `[0,0.25,0.5,0.75,1]`.

Expected values must use independently specified pigment coordinates and the
shader contract, not call the display function being tested. Retain the check
that the JavaScript cube corners match the production shader. Use a maximum
one-channel rounding error of one 8-bit unit for numeric-to-CSS checks.

Include Digital endpoints: s=0,v=1 is black; v=0 is white; h=0,s=1,v=0.5
is `(255,128,255)` after rounding. A Natural-only test does not cover the mode
branch or its swizzle.

### Actual boundary and shader integration

Drive a selection through the real widget, then synthesize a paint interaction
and capture the colour passed to `engine.splat`. Assert its first three
components against the expected pigment triple. Observe actual calls rather
than testing `hsvToRyb` in isolation. Verify alpha separately.

Pass known constant pigment data through a test GPU render using the actual
production `rybToRgb` function and each model branch. Read back flat base RGB
and compare with the UI reference within two 8-bit units per channel. Extract
or reuse that shader function for the diagnostic pass; do not copy a second
independent implementation and call it engine verification. This separates
colour conversion errors from lighting and fluid-motion differences.

Capture the actual RGB passed to the brush viewer and compare it with that
same reference. Add opaque/settled stroke checks on a controlled background
for the reported selections, accounting explicitly for production lighting.
Do not require arbitrary shaded stroke pixels to equal a flat UI swatch.

### Rendered UI and interactions

Read actual disc and slider raster pixels at several interior radii and hues,
including mixed-pigment sectors, not just their CSS declarations or rim stops.
Avoid antialiased edges and handle outlines. For screenshot comparisons use
a per-channel tolerance of three 8-bit units at interior sample points, with
fixed browser scale and no image rescaling.

Check selected handle fills and preview inputs against those samples. Let
Preact settle before reading DOM, but also verify redraw after a completed
pointer drag. Cover model toggles, value drags, hue-wrap seam, both wheel
directions, nondefault angle, panel resize, device pixel ratios 1 and 2, and
host-driven colour restoration. Model toggling must leave stored HSVA intact.

The compact strip is a full-strength reference: compare it with the disc rim
at v=1, not with a reduced-value selection. Alpha changes must preserve the
disc RGB and pigment triple.

### Regression and test sensitivity

Run the revised colour probe against source and production build; the paint
path is preserved. Run shader lint if shader-related harness code is
introduced.

Temporarily reintroduce each failure and verify the appropriate test fails:

- RGB value multiplication: half-value red preview/base-colour test.
- Original white/black overlays: interior disc raster tests.
- Stale model cache: mode-toggle raster and preview tests.
- Passing display RGB as pigment: actual splat-boundary test.
- Missing Digital channel swap: Digital numeric/GPU tests.

Remove all sabotage changes before delivery. Inspect the three reported cases
visually and record the tested browser/rendering configuration. Report probe
and build results separately; no single pass count establishes parity.

## Completion criteria

Every displayed selected colour comes from the same pigment triple that the
brush deposits. The full disc and slider interiors use that contract. The
reported centre, zero-value, and half-value-red cases agree across picker,
handles, preview, and engine base colour in both modes. Existing paint output
remains unchanged, and documentation no longer describes the divergent formula
as correct.
