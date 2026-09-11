# Handoff 2 — specifications for Phase 8a and Phase 9a

Written 2026-09-08 after reviewing the implementation, the Phase 9 reuse host,
the golden harness, and the Tilecraft render schema.

> **УВАГА (2026-09-08):** часову модель Phase 9a в цьому файлі виправлено
> документом `docs/STROKE-TIMING-CONTRACT.md`. Вимоги «each method performs all
> … fluid steps before it returns», заборона `frame()` під час мазка і
> «changing caller timing … does not change output» **скасовані**: вони
> ототожнюють просторовий крок із кроком фізичного часу. Читати §"Scope and API
> level", §"Exact step order" і §"Phase 9a verification" тільки разом із тим
> документом.

This document supersedes only the incomplete Phase 8a and Phase 9a sections of
`FLUID-ENGINE-EXTRACTION-PLAN.md`. It does not claim that either phase has been
implemented. The current code still exposes only `initializeBrush`,
`positionBrush`, `splat`, and `frame`; no `beginStroke`, `strokeTo`, or
`endStroke` implementation or test exists.

The working tree already contains unrelated colour-picker work. Preserve it.
Implement these phases as a separate change and do not fold the colour-parity
repair into it.

## Findings that change the old specification

The old plan is directionally right but not complete enough to implement.
These details come from the current code and are now part of the contract:

1. `FluidEngine.frame()` advances the fluid simulation only. It does not make
   bristles fall. Settling requires repeated `positionBrush()` calls at the
   press position, because that calls `Brush.update()`.
2. A tap must deposit during its settling steps. If `beginStroke()` settles
   without calling `splat`, then `beginStroke(); endStroke()` is blank. The
   current app calls `positionBrush -> splat -> frame` on every RAF after a
   pointer press; the first calls deposit nothing, and later settling calls
   begin depositing when bristles cross the threshold.
3. The golden harness does not call engine primitives directly. It sends DOM
   pointer events, waits ten RAFs after pointer-down, and uses 12 equal steps
   per input segment. It proves the old app path, not a named stroke API.
4. The second host already exists in `examples/minimal`. It confirms Phase 9a
   is needed, so the instruction to build that host first has been satisfied.
5. Tilecraft `s` is `[0.5..20]` relative size. Its schema says it may represent
   brush scale or stylus pressure depending on the renderer. It must not be
   passed blindly into an engine pressure field constrained to `[0..1]`.
6. `Brush.initialize()` reuses one random texture for the lifetime of the
   brush. Calling it on every press is necessary but not sufficient for Phase
   8a; the shader also needs a per-press variation value.
7. The engine header says there is no `engine.brush` or `engine.simulator`
   escape hatch, but both are presently ordinary instance properties. Hosts do
   not use them. These phases must not introduce new host dependencies on them;
   making them truly private is outside this scope.

## Phase 8a — per-press bristle variation

### Required behaviour

Every physical press receives a new bristle layout variation. The variation is
chosen once when the press begins and remains fixed through every settling,
movement, and splat step until lift. Repeated taps with identical brush settings
must no longer produce translated copies of the same star-shaped stamp.

The variation must alter individual angular/radial jitter rather than rotate
the entire brush as one rigid object. A sequence of taps should look like the
same brush being placed naturally, not like a stamp tool being visibly spun.

Given the same explicit random seed and the same sequence of API calls, output
must be byte-for-byte reproducible on the same supported GPU path. Different
seeds must produce different tap layouts. There must be no random draw per
frame, per interpolation sample, per bristle, or per splat after initialization.

### Random-source ownership

Extend the `FluidEngine` constructor options with an optional `random` function:

```js
new FluidEngine(wgl, shaderSources, {
  resolutionWidth,
  resolutionHeight,
  maxBristleCount,
  random, // optional function returning a finite number in [0, 1)
});
```

The engine stores one source and passes it into `Brush`. If omitted, capture
`Math.random` during construction. This preserves the existing `?seed=` golden
harness, which installs its deterministic `Math.random` before engine creation,
while removing bare random calls from `Brush`.

Use this source both to build the existing random texture and to obtain exactly
one `strokeVariation` value per real press. Validate injected return values and
throw a named error when they are not finite or outside `[0,1)`. Do not silently
fall back to nondeterministic randomness.

Tests should inject their own generator directly. URL parsing and the global
`debug/deterministic-rng.js` shim remain host/debug concerns and must not move
into the engine.

### Brush and shader change

Add a `u_strokeVariation` float uniform to `setbristles.frag`. In
`Brush.initialize()`, draw one new value from the engine-owned source and bind
it while running the set-bristles pass.

Combine it with the existing per-bristle `randoms.zw` before the sunflower
formula. The combination must perturb the two components independently, for
example by adding distinct irrationally-related offsets and taking `fract`:

```glsl
vec2 strokeRandom = fract(
    randoms.zw + vec2(u_strokeVariation,
                      u_strokeVariation * 0.61803398875 + 0.38196601125));
```

Use `strokeRandom.x` for angular jitter and `strokeRandom.y` for radial jitter.
Do not add one shared angle to every bristle. Keep `BRISTLE_JITTER`, the
sunflower base formula, bristle lengths, constraints, and iteration count
unchanged.

The exact constants may be adjusted if a probe finds correlation, but the
approved shape is one uniform and shader arithmetic, with no texture upload on
press. Record final constants in the shader comment and probe.

`initializeBrush()` remains a low-level operation and receives a new variation
on every call. Its current comment claiming it settles the bristles is false;
change it to say that it places/reseeds them and that callers of the primitive
must advance `positionBrush()` themselves. `beginStroke()` is the public
operation that owns both reseeding and settling.

### Integration order

Implement Phase 8a and Phase 9a in one integration sequence:

1. Inject the random source and implement the shader variation.
2. Implement the named stroke state machine.
3. Migrate the main app's painting presses and the minimal scripted example to
   the named API, so `initializeBrush()` is reached on every press.
4. Keep low-level primitives public for specialized hosts and diagnostics, but
   stop presenting them as the recommended way to paint a stroke.

Changing only `Brush.initialize()` will not fix the main app today because
`paint.js` sets `brushInitialized` once and normally does not initialize again
on later taps.

### Phase 8a verification

Create a dedicated repeat-tap probe. Use a seeded random function, fixed colour,
fixed brush settings, a clean controlled background, and at least eight taps
far enough apart that their paint regions do not overlap. Crop equal regions
around each settled stamp and compare position-normalized paint data.

Acceptance conditions:

- at least six of eight stamp hashes differ;
- no non-reference stamp is nearly identical to the first under a documented
  normalized pixel-distance threshold;
- repeating the whole run with the same seed gives identical hashes in order;
- changing the seed changes at least six hashes;
- one press followed by many `strokeTo` calls consumes no additional random
  values until the next `beginStroke`;
- fixing `u_strokeVariation` to a constant makes the diversity test fail;
- drawing a new variation every frame makes the random-call-count/continuity
  test fail.

The existing 12 paint goldens are expected to change because every first press
now has a per-stroke variation. Before recording replacements, run the old and
new builds with the same seed and establish that colour means, stroke bounds,
and total deposited alpha remain within documented tolerances. Then record the
new source baselines once and require the dist build to match them. A changed
hash by itself is neither acceptance nor evidence of a regression.

## Phase 9a — named stroke API

### Scope and API level

This is a synchronous, deterministic, high-level API for replaying input paths.
Each method performs all brush, splat, and fluid steps needed for its portion of
the stroke before returning. It schedules no RAF, timer, promise, or rendering.
The host may render after any call.

The high-level API owns simulation stepping while it executes. A host must not
also insert `engine.frame()` calls between the internal samples if it expects
reproducible output. A continuously animated host may continue advancing idle
fluid after a stroke call returns, but such extra frames are intentionally part
of that host's result.

While named-stroke state is active, direct calls to the mutating low-level
stroke primitives (`initializeBrush`, `positionBrush`, `splat`, and `frame`)
must throw `StrokeStateError`. Implement the named API through private internal
helpers so its own samples bypass that public guard. This turns accidental
mixing of the two driving modes into a visible integration error instead of
double deposition.

Use an explicit pigment payload and include all state needed by `splat`; the
old three-argument sketch omitted these requirements:

```js
engine.beginStroke({
  x,
  y,
  pressure: 1,
  brushSize,
  paintingRectangle,
  color: {
    space: 'pigment',
    channels: [p0, p1, p2],
    alpha
  },
  resolutionScale: 1
});

engine.strokeTo({ x, y, pressure: 1 });
engine.endStroke();
```

`beginStroke()` and `strokeTo()` return:

```js
{ steps, simulationUpdated }
```

`steps` is the number of internal `positionBrush -> splat -> frame` samples
performed by that call. `simulationUpdated` is true if any internal `frame()`
reported movement. `endStroke()` returns the same shape because it may flush a
final sample.

The object form leaves room for additive optional fields without breaking
callers. Do not add positional overloads.

### Input contract

- `x`, `y`: finite coordinates in the same bottom-left-origin engine pixel
  space as `paintingRectangle`. The engine performs no DOM, CSS, DPR, frame,
  Tilecraft, or camera conversion.
- `pressure`: finite normalized height multiplier in `[0,1]`, default `1` at
  begin and otherwise retained from the previous point when omitted. Reject
  values outside the range; do not guess whether a larger number is brush size.
- `brushSize`: finite engine-pixel brush scale greater than zero. It is fixed
  for a stroke. Use `50` to reproduce the main app default.
- `paintingRectangle`: required Rectangle-compatible value used for every splat
  in that stroke. Snapshot its numeric bounds at begin so later host mutation
  cannot change half of a stroke. It must have finite positive width/height.
- `color.space`: must equal the literal `'pigment'`. This makes an accidental
  RGB array fail loudly instead of producing plausible wrong mixing.
- `color.channels`: three finite normalized pigment coordinates in `[0,1]`.
  They are the numerical values currently produced by `hsvToRyb`; do not rename
  or reorder their axes inside the engine.
- `color.alpha`: finite normalized deposited alpha in `[0,1]`, fixed for the
  stroke. This is paint amount, independent of pigment channels.
- `resolutionScale`: finite positive simulation-to-engine scale, fixed for the
  stroke. It participates in the current velocity scale and defaults to `1`.

Colour conversion stays outside `FluidEngine`. For the current app, pass
`hsvToRyb(h,s,v)` as `channels` and its existing bristle-count-dependent alpha
as `alpha`. A Tilecraft adapter must decide what its hex means and perform the
conversion there; the engine must not import `common.js`, parse hex, or pretend
an arbitrary display RGB colour has a unique inverse in the RYB cube.

Tilecraft `s` should normally determine `brushSize`, using the already computed
`ss = s * layer.gridSize * layer.scale * groupInfo.ratio`. If a particular
Tilecraft tool defines `s` as stylus pressure, its adapter must normalize that
value to `[0,1]` explicitly. The engine cannot infer which interpretation was
intended.

### Preserved paint constants

Move the currently duplicated stroke constants into private named constants in
the engine's high-level stroke implementation:

```text
height        = 2.0     * brushSize * max(pressure, 0.15)
zThreshold    = 0.13333 * brushSize
splatRadius   = 0.05    * brushSize
velocityScale = 0.14    * alpha * resolutionScale
settleSteps   = 10
spacing       = max(1 engine pixel, 0.15 * brushSize)
```

The `0.15` pressure floor preserves the main app's pen-pressure rule. Zero
pressure is accepted as an input/lift sample but produces the floor height for
the final physical step; `endStroke()` remains the authoritative lift.

The spacing value formalizes the approximate behaviour already used by the
golden scenarios: at brush size 50 it emits every 7.5 engine pixels. Treat it as
a versioned stroke-dynamics constant. Do not silently tune it to make a single
golden pass. If later made configurable, expose a named option with validation
and keep this value as the default.

The existing low-level primitives retain their signatures and semantics. The
new constants govern the named API only.

### Exact step order

One internal sample is exactly:

```text
positionBrush(x, y, computedHeight, brushSize)
splat(savedPaintingRectangle, computed splat options)
frame()
```

Do not swap splat and frame. The current application uses this order, and a
swap deposits this sample into a different fluid state.

`beginStroke()` performs these operations synchronously:

1. validate and snapshot all arguments;
2. reject the call if a named stroke is already active;
3. call `initializeBrush(x,y,height,brushSize)` exactly once, which also selects
   the Phase 8a variation;
4. establish the first input/emitted point and zero interpolation remainder;
5. perform exactly ten internal samples at the press coordinates.

Settling samples include splat. This reproduces contact onset and makes a tap
visible. No special dot primitive is needed.

`strokeTo()` arc-length resamples the incoming polyline at the fixed spacing.
It carries unused distance across calls, so splitting one straight segment into
many caller points produces the same emitted positions as passing its endpoint
once. Interpolate pressure linearly along the caller segment at each emitted
sample. Save the latest caller endpoint even if the segment is shorter than the
remaining spacing. Do not force every caller endpoint into the simulation.

`endStroke()` flushes the latest caller endpoint once if it differs in position
or pressure from the last emitted sample, then clears all stroke state. It does
not add arbitrary lift/settle frames afterward. This bounds live-path lag below
one spacing interval and ensures a path reaches its specified endpoint without
making intermediate segmentation affect its dynamics.

For a closed Tilecraft group, the adapter calls `strokeTo()` with the group's
first transformed point before `endStroke()`. The engine has no `close` flag.

### State machine and errors

Named stroke state has two states: `idle` and `active`.

| Current state | Call | Result |
| --- | --- | --- |
| idle | `beginStroke` | validate, reseed, settle, enter active |
| active | `strokeTo` | resample and emit zero or more steps |
| active | `endStroke` | flush endpoint, clear state, enter idle |
| active | `beginStroke` | throw `StrokeStateError` |
| idle | `strokeTo` | throw `StrokeStateError` |
| idle | `endStroke` | throw `StrokeStateError` |

Validation happens before any GPU mutation or random draw. A failed begin must
leave the engine idle and must not consume a variation. If an internal GPU call
throws after begin has mutated state, clear named stroke state in `finally` and
rethrow; the caller can start a new stroke, though its partial GPU output cannot
be rolled back.

Add `cancelStroke()` only if migration demonstrates a real distinction from
`endStroke()`. Pointer cancellation currently lifts without rollback, so
`endStroke()` is sufficient. Do not expand the API speculatively.

`setBrush({bristleCount})`, resolution changes, painting resize, clear, snapshot
restore, and destruction must reject while a named stroke is active. Rendering
and readback are allowed. Direct low-level stroke primitives are rejected as
described above. This prevents a stroke whose saved scale, rectangle, or
simulation dimensions change halfway through.

### Host migration

Migrate painting interaction in `paint.js` so every actual painting press calls
`beginStroke`, movement calls `strokeTo`, and pointer-up/cancel/loss calls
`endStroke` exactly once. Panning, resizing, hover, and debug brush placement
must not start a named paint stroke. Keep viewport conversion and undo policy in
the host.

Because the named API advances simulation internally, remove the old
position/splat/frame path for an active named stroke from the main RAF loop.
The RAF may continue advancing idle fluid and rendering. Do not run both paths;
that would double deposition and simulation steps.

Adapt `examples/minimal` to demonstrate the recommended API. Rewrite the golden
harness to drive named methods directly for stroke-API coverage, while retaining
at least one pointer integration scenario for the app's event wiring.

### Phase 9a verification

Add a dedicated stroke API probe with instrumented methods or a small fake
engine backend for call-order/state tests, plus WebGL integration cases for
paint output.

Required checks:

- `beginStroke` calls initialize once, then exactly ten ordered
  position/splat/frame samples at the press point;
- `beginStroke(); endStroke()` deposits a visible tap;
- no random draw occurs for invalid begin, movement, or lift;
- one random draw occurs for each valid begin after random-texture construction;
- all invalid state transitions and non-finite/out-of-range inputs fail loudly;
- a failed call does not strand the state machine active;
- two geometrically identical straight paths, one supplied as one segment and
  one split into at least 20 uneven segments, emit identical samples and paint
  hashes with the same seed;
- segment lengths not divisible by spacing carry the remainder correctly;
- pressure at emitted samples is the linear arc-position interpolation and the
  exact final pressure is flushed at end;
- changing caller timing, including long pauses, does not change output;
- RGB-shaped input without `space: 'pigment'` is rejected;
- a known pigment pair still passes the existing yellow/blue-to-green mixing
  assertion;
- source and dist expose the same methods and produce matching deterministic
  output;
- no host reads `engine.brush`, `engine.simulator`, or `engine.renderer`.

Sabotage-test the suite by independently removing settling, swapping frame and
splat, resetting interpolation remainder per `strokeTo`, passing RGB as pigment,
and fixing the bristle variation. Each sabotage must fail a named check that
describes the broken invariant.

## Phase 9b — polygon brush footprints and shape selector

This is the final phase in this handoff. Implement it after the Phase 8a
variation and Phase 9a stroke lifecycle are stable. A polygon tile is a single
named stroke (`beginStroke` followed by `endStroke`), and its orientation must
remain fixed for that whole press.

### Model behaviour

Tilecraft has two different painting operations. The adapter must preserve the
distinction:

- `polyline` is one continuous drag with the round brush. A change of `g` or a
  positive `b` ends the current stroke and begins a new one. If `gz` is set,
  send the group's first transformed point through `strokeTo()` before lift.
- `polygon`, `square`, and `circle` tiles are individual taps. Each tile calls
  `beginStroke()` and `endStroke()` at its coordinate. The brush is lifted while
  moving to the next tile even when the tiles share a group.
- `layer.polygonSize` supplies the regular-polygon side count. The engine must
  support the model's complete range `3..8`, although the first app selector
  exposes only the requested `3..6` choices.
- `tile.sa`, when present, is the shape rotation in radians. Host and frame
  transforms must be composed before this value reaches the engine.
- `tile.ss`, or the equivalent calculation from `s`, `gridSize`, layer scale,
  and group ratio, determines `brushSize`. It is not raw normalized pressure.

`slash` remains an adapter concern and is outside this phase. Do not silently
render it as a polygon or continuous polyline without an explicit mapping.

### Public shape contract

Extend the named stroke options and `setBrush()` with a validated shape object:

```js
engine.setBrush({
  shape: { kind: 'circle' }
});

engine.beginStroke({
  // existing Phase 9a fields...
  shape: {
    kind: 'regularPolygon',
    sides: 6,
    rotation: 0,
    edgeSoftness: 0.05
  }
});
```

Shape is snapshotted by `beginStroke()` and cannot change while a named stroke
is active. A begin option overrides the configured brush default for that
stroke only. Omitting it uses the configured default. The initial default is
`{kind:'circle'}`, preserving the existing round brush.

Validation rules:

- `kind` is exactly `circle` or `regularPolygon`;
- `regularPolygon.sides` is an integer from 3 through 8;
- `rotation` is a finite angle in radians and defaults to `0`;
- `edgeSoftness` is finite in `[0,0.25]` and is a fraction of `brushSize`;
- invalid shape data fails before GPU mutation or a Phase 8a random draw.

For the UI and Tilecraft adapter, define these stable presets:

| Preset value | Engine shape | Default orientation |
| --- | --- | --- |
| `circle` | `{kind:'circle'}` | rotation ignored |
| `square` | regular polygon, 4 sides | `PI/4`, giving horizontal/vertical edges |
| `polygon-3` | regular polygon, 3 sides | rotation `0` |
| `polygon-4` | regular polygon, 4 sides | rotation `0` |
| `polygon-5` | regular polygon, 5 sides | rotation `0` |
| `polygon-6` | regular polygon, 6 sides | rotation `0` |

Add `tile.sa` to the preset's default rotation during model playback. `square`
and `polygon-4` intentionally remain distinct presets: their default
orientation differs, and the model distinguishes a square from a generic
four-sided polygon.

### Why two GPU changes are required

The brush has no single circular bitmap. Its footprint comes from two separate
operations:

1. `setbristles.frag` distributes bristle roots over a disk with the jittered
   sunflower formula.
2. `splat.vert` and `splat.frag` deposit a round capsule along each moving
   bristle.

Changing only the root distribution gives a recognizable polygon with rounded,
wandering edges. Changing only the splat mask clips the circle but may leave
sparse polygon corners. Implement both changes.

### Polygonal bristle distribution

Add shape uniforms to `setbristles.frag`:

```glsl
uniform float u_shapeSides;     // 0.0 means circle, otherwise 3.0..8.0
uniform float u_shapeRotation;  // radians
```

Keep the existing sunflower angle and area-radius term. For a polygon, scale
the normalized radius by the distance from the centre to the regular-polygon
boundary at that angle. Rotate the boundary by `u_shapeRotation`. Circle uses a
boundary factor of exactly `1.0` and preserves the previous layout apart from
the intentional Phase 8a variation.

Test whether the polar mapping creates visibly sparse corners. If it does,
replace it with deterministic uniform sampling of the regular polygon's
centre-to-edge triangles. Do not compensate by globally increasing bristle
count, which would change paint density for every shape.

`Brush.update()` runs `setBristlesProgram` again for the base row on every
simulation step. Bind `u_shapeSides`, `u_shapeRotation`, and the Phase 8a
`u_strokeVariation` in both the initialization draw state and the update draw
state. Relying on a uniform's previous GL value would make shape continuity
sensitive to unrelated program use.

Phase 8a may vary individual bristle jitter inside the selected boundary. It
must not vary shape rotation, side count, polygon centre, or edge mask. A
triangle must remain pointed in the model-specified direction across seeded
runs.

### Polygon deposition mask

Pass the saved stroke shape to both paint and velocity splat programs:

```glsl
uniform vec2  u_brushCenter;
uniform float u_brushShapeRadius;
uniform float u_shapeSides;
uniform float u_shapeRotation;
uniform float u_shapeEdgeSoftness;
```

In `splat.frag`, evaluate a regular-polygon signed distance or equivalent inside
distance using `v_quadPosition`, the centre, `brushSize`, side count, and
rotation. Circle returns mask `1.0`, preserving the current capsule. Polygon
multiplies the existing splat multiplier by a feathered inside mask. Apply the
same mask to paint alpha and velocity alpha so invisible paint outside the
shape cannot inject fluid motion.

`u_splatRadius` remains the radius of an individual bristle capsule;
`u_brushShapeRadius` is the complete brush or tile radius. Do not conflate them.
The mask clips initial deposition, not later fluid simulation: wet polygon
edges may soften and deform after landing. A consumer requiring immutable,
mathematically exact polygons needs a vector renderer rather than this path.

### Main application UI

Add a native select to `#panel-body` between Brush Size and Paint Color:

```html
<label class="control-label" for="brush-shape">Brush Shape</label>
<select id="brush-shape" class="control-select">
  <option value="circle">Circle</option>
  <option value="square">Square</option>
  <option value="polygon-3">Polygon 3</option>
  <option value="polygon-4">Polygon 4</option>
  <option value="polygon-5">Polygon 5</option>
  <option value="polygon-6">Polygon 6</option>
</select>
```

Use a real `<label>` and native `<select>` for keyboard, touch, and screen-reader
behaviour. Style `.control-select` in `app/layout.css` to match the panel width,
height, colours, and visible focus state. Do not build another pointer-only
custom control.

Add a small app-owned shape control module or bind it in the existing UI setup.
It stores the selected preset, calls `engine.setBrush({shape})`, and supplies
the same shape to the brush preview. The initial selection is Circle. Disable
the select while painting or defer its change until `endStroke`; it must not
mutate half of an active footprint.

The brush preview must show the selected outer footprint and orientation, not
only recolour the existing circular preview. Use the same regular-polygon
boundary calculation as the engine or a CPU equivalent checked against it.
The preview illustrates bristle placement but does not predict later fluid
deformation.

Add every new JavaScript file to `index.html` and `gulpfile.js` in dependency
order. Collapsing and reopening the panel must preserve the selected value.
Undo and redo continue to restore paint pixels and do not change current brush
shape unless snapshot policy is separately expanded.

### Phase 9b verification

Add CPU/GPU geometry checks and rendered integration cases:

- Circle with a fixed seed preserves the pre-shape footprint within the Phase
  8a baseline. Selecting another shape and returning to Circle is identical.
- Side counts `3..8` are accepted; `2`, `9`, fractions, NaN, and unknown kinds
  fail before random consumption or GPU mutation.
- Root positions remain inside each mathematical polygon and occupy every
  corner region under several fixed seeds.
- Paint and velocity outside the polygon mask remain zero immediately after a
  controlled tap, within the documented antialias feather.
- Interior deposition is nonzero and total alpha remains within a documented
  tolerance across shapes at equal brush size.
- `square` has horizontal and vertical edges; `polygon-4` has vertex-oriented
  defaults; `tile.sa` rotates either result by the expected angle.
- Shape, side count, and orientation remain constant through settling and every
  `strokeTo`; only a new begin may select another shape.
- Phase 8a changes internal bristle texture between presses without changing
  the requested polygon boundary or orientation.
- All six UI values select the correct engine shape, survive panel
  collapse/expand, work from the keyboard, and cannot alter an active stroke.
- Polygon, square, and circle playback makes one begin/end pair per tile and
  paints no connector between coordinates.
- Polyline playback retains Circle and lifts/re-presses at every group change
  and positive `b`, with `gz` closing before lift.
- Source and dist results match on desktop and a supported mobile GPU path.

Sabotage separately by removing the root boundary, removing the splat mask,
omitting shape uniforms from `Brush.update`, masking paint but not velocity,
and treating polygon tiles as one continuous stroke. Each change must fail a
specific check.

## Delivery checklist

1. Implement Phase 8a random injection and shader variation.
2. Implement Phase 9a state machine and resampling in `fluid-engine/index.js`
   or a new engine-owned file loaded immediately before it.
3. Implement Phase 9b polygon distribution, matching splat mask, shape API,
   Tilecraft mapping, brush preview, and native UI selector.
4. If a new file is added, list it in every source host and in `gulpfile.js` in
   dependency order; add shader files only if the existing file is not edited.
5. Migrate the main app and minimal host without touching colour-picker work.
6. Add repeat-tap, state/order, resampling, colour-boundary, shape-geometry,
   UI-selection, and integration probes. Keep at least one DOM pointer test.
7. Run shader lint, all relevant phase probes, source goldens, production build,
   and dist goldens.
8. Inspect repeated taps, all UI shape choices, isolated polygon tiles, and a
   continuous pressure-varying stroke on desktop and one mobile GPU path.
9. Re-record golden baselines only after the Phase 8a/9b invariants and
   aggregate paint tolerances pass; record why hashes changed.
10. Update `FLUID-ENGINE-API.md`, `API-FINDINGS.md`, `api-usecases.md`, the phase
   plan, and the main handoff from “open” to “done” only after all checks pass.

Completion means repeated presses vary reproducibly, a single press never
rerolls, every caller can paint a deterministic path without knowing the
settling, interpolation, call-order, or pigment-boundary traps, and Circle,
Square, and Polygon 3–6 can be selected in the main UI while the engine and
Tilecraft adapter support regular polygons through eight sides.
