# Fluid Paint — Mobile GPU Bristle Collapse

> **STATUS (2026-09-06): RESOLVED. Diagnosis confirmed, fix implemented, and
> VERIFIED WORKING ON A PHYSICAL SAMSUNG A56.**
>
> The device that motivated this investigation now paints correctly. The
> filtering bug is closed.
>
> - Reproduced on desktop: `?gpu=samsung-a56-boots` painted a fully blank canvas
>   for a stroke that paints correctly unclamped.
> - Root cause proven directly: a FLOAT+LINEAR texture round-trip reads back
>   `[0,0,0,1]` per texel — exactly `vec4(0,0,0,1)` — while FLOAT+NEAREST reads
>   back correctly.
> - Fixed in commit `a31ea61`; `?gpu=samsung-a56` now boots and paints a correct
>   bristle stroke where it previously showed the capability-gate error page.
> - Holds on the strict SwiftShader/Vulkan ANGLE backend as well as D3D11.
> - **Confirmed on the physical Samsung A56 by the project owner.** Procedure:
>   [DEVICE-VERIFICATION.md](DEVICE-VERIFICATION.md).
> - §5 migration is now an open choice on its own merits, not a remediation
>   step — the WebGL 1 path works on the affected hardware.
>
> Corrections to the original analysis, from what the harness actually showed,
> are marked **[CONFIRMED]** / **[CORRECTED]** inline below.

**Findings & Remediation Spec**

Author: analysis pass, 2026-09-06
Subject: `fluid-paint` (fork of david.li/paint), branch `brush-pbd-fixes`
Symptom: on mobile/tablet GPUs the PBD bristles collapse toward `0.0` instead of standing
orthogonal to the canvas and following forces. Only the bottom-left corner region of the
canvas produces paint; everywhere else nothing lands.

---

## 0. TL;DR

The bug is **not in the shader math**. The PBD solver is correct and unchanged from the
original. The bug is a **silent texture-format downgrade**: the Samsung Xclipse 540 (and most
mobile GPUs) do **not** expose `OES_texture_float_linear`. The brush simulation state textures
are all created with `LINEAR` filtering on a `FLOAT` internal format. Per the OES spec, a float
texture with a linear filter and no `OES_texture_float_linear` is **incomplete**, and every
`texture2D()` fetch from it returns **`vec4(0,0,0,1)`**.

That single fact explains the entire symptom set:

| Observation | Explanation |
|---|---|
| Bristles collapse to `0.0` | `texture2D(u_positionsTexture, …)` returns `(0,0,0)` — the origin |
| Only bottom-left corner works | The origin `(0,0)` *is* the bottom-left of the painting rect — the only place the collapsed brush overlaps the canvas |
| Bristles not orthogonal | Their `z` reads back as `0.0`, so the whole bristle chain is flat in the z=0 plane |
| Desktop is fine | Desktop exposes `OES_texture_float_linear`, so the same code path is complete |
| Debug visualizers showed "wrong orientation" but not the cause | They correctly rendered the collapsed state; the collapse is upstream of anything they instrumented |

The correct fix is **not** to rewrite the PBD shaders. It is to stop asking for linear
filtering on state textures that are only ever point-sampled anyway.

The corollary finding: `index.html` gates the whole app on `hasFloatTextureSupport()`, which
requires `OES_texture_float_linear`. So a device that *fails* the check shows the "no WebGL
float textures" page, and a device that *passes* the check but has a partial/quirky driver
runs with silently-zero textures. There is a middle band of devices — and the A56 appears to
sit in it — where the extension probe and the actual sampler completeness disagree.

---

## 1. Evidence

### 1.1 Device capability delta

From `webgl-probe-desktop.json` vs `webgl-probe-samsung-a56.json`:

```
                                    desktop        Samsung A56 (Xclipse 540)
OES_texture_float                   true           true
OES_texture_float_linear            TRUE           FALSE      <-- the whole bug
OES_texture_half_float              true           true
OES_texture_half_float_linear       true           true
WEBGL_color_buffer_float            true           true
EXT_float_blend                     true           true
highp fragment precision            23 bits        23 bits    (fine)
mediump fragment precision          23 bits        10 bits    <-- second-order hazard
```

Note that `highp` is genuinely 23-bit on the A56 — so **precision of `highp` is not the
problem**. The problem is filterability, which is an orthogonal capability.

Also relevant, and a separate second-order issue:

```
devicePixelRatio                    1              2.8125
screen.width                        1920           384
MAX_TEXTURE_SIZE                    16384          8192
```

At DPR 2.8125 a 384-CSS-px viewport backs onto ~1080 device px. Combined with the quality
`resolutionScale`, this pushes the painting texture toward a different size class than desktop
ever exercises — see §4.3.

### 1.2 The offending code

**[CORRECTED]** The problem is not confined to `brush.js`. The `?audit=1` pass
found FLOAT+LINEAR textures in `brush.js` (7), `simulator.js` (12) and `paint.js`
(5) — the fluid paint/velocity/pressure textures and the undo snapshots are
affected too. The brush is simply where the failure is most visible.

`brush.js` creates **six** simulation state textures, all identically:

```js
this.positionsTexture = wgl.buildTexture(
  wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
  null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
);
```

(`positionsTexture`, `previousPositionsTexture`, `velocitiesTexture`,
`previousVelocitiesTexture`, `projectedPositionsTexture`, `projectedPositionsTextureTemp`,
plus `randomsTexture` — `brush.js:56-110`.)

Every consumer of these textures samples at **exact texel centers**:

- `project.frag`, `updatevelocity.frag`, `planeconstraint.frag` — `gl_FragCoord.xy / u_resolution`
- `distanceconstraint.frag`, `bendingconstraint.frag` — `(index + 0.5) / u_pointCount`
- `brush.vert`, `splat.vert` — from `brushTextureCoordinates` / `splatCoordinates`, built as
  `(bristle + 0.5) / maxBristleCount`

So `LINEAR` buys nothing. It is requested, never used, and on a device without
`OES_texture_float_linear` it makes every one of these textures incomplete.

**One genuine exception:** `splat.vert` samples at
`ty = (vertex + 0.5 + t) / VERTICES_PER_BRISTLE` where `t = (i + 0.5) / SPLATS_PER_SEGMENT`
(`brush.js:118-122`). That is an intentional *interpolated* fetch — it walks along a bristle
segment to lay down 18 splats between two vertices. This one path really does want linear
filtering. See §4.2 for how to handle it without the extension.

### 1.3 Why exactly the bottom-left corner

When the fetch returns `(0,0,0)`:

- `setbristles.frag` still writes correct positions into row 0 (it computes from uniforms, not
  from a texture — except for the randoms fetch, which also returns 0, killing the jitter).
- `project.frag` reads `position = (0,0,0)`, `velocity = (0,0,0)`, applies gravity, writes
  `(0, 0, -10)`.
- Every constraint pass then reads `(0,0,0)` again and re-collapses.
- `splat.vert` computes `planarPosition = position.xy = (0,0)`.
- `gl_Position = -1.0 + 2.0 * (finalPosition - u_paintingPosition) / u_paintingDimensions`

With `finalPosition ≈ (0,0)` this maps to the painting rect's origin corner — the bottom-left.
Splats land there and nowhere else. **The "only bottom-left is reachable" report is a direct,
predicted consequence of the zero-fetch, not a separate bug.**

Additionally `splat.vert` divides by `dist`:

```glsl
float dist = distance(previousPlanarPosition.xy, planarPosition.xy);
vec2 direction = (planarPosition - previousPlanarPosition) / dist;
```

When both positions collapse to the same zero vector, `dist == 0.0` and `direction` becomes
`NaN`, which poisons `finalPosition` and discards the primitive on some drivers. This is why
even the bottom-left corner is intermittent rather than a solid blob.

### 1.4 Why the previous fix attempts failed

Branches `codex_fuckup` and `sonet_fuck_up` both attacked the PBD math. That was the wrong
layer. Reading `distanceconstraint.frag`, `bendingconstraint.frag`, `project.frag` and
`planeconstraint.frag` against the original: the math is sound. Tuning stiffness, reordering
passes, adding epsilon guards, or rewriting the solver cannot fix a sampler that returns zero.

The debug tooling (`debug.js`, `debug2.js`) visualized bristle orientation faithfully — it
showed a collapsed brush because the brush *was* collapsed. What the tooling lacked was a
**readback assertion at the texture level**: "write a known non-zero pattern, read it back,
assert equality." That single test would have isolated this in minutes. §3.1 specifies it.

---

## 2. Root cause statement

> On GPUs lacking `OES_texture_float_linear`, all six brush simulation state textures in
> `brush.js` are texture-incomplete because they are created with
> `TEXTURE_MIN_FILTER = TEXTURE_MAG_FILTER = LINEAR` on a `FLOAT` type. All `texture2D()`
> fetches from them return `vec4(0,0,0,1)`. The PBD solver therefore integrates from the
> origin every frame, the bristle chain collapses to `(0,0,0)`, and splats are emitted only at
> the painting rect's origin corner.

Severity: **blocker on all mobile GPUs**. Cause: **texture state, not shader math**.

---

## 3. Deliverable A — Desktop sandbox that reproduces mobile behavior

The goal is a Windows-local harness that makes the A56 failure appear on a desktop machine, so
the fix can be iterated without a phone in hand.

### 3.1 Tier 1 — capability-clamp harness (highest value, ~1 hour)

Do not emulate the GPU. **Emulate the missing capability.** Wrap the `WebGLRenderingContext`
before `WrappedGL` ever touches it and deny the extensions a target device lacks.

`debug/gpu-profiles.js`:

```js
// Device capability profiles, sourced from the probe JSONs.
const GPU_PROFILES = {
  'desktop': { deny: [] },
  'samsung-a56': {
    deny: ['OES_texture_float_linear'],
    maxTextureSize: 8192,
    devicePixelRatio: 2.8125,
    mediumFloatPrecision: 10,
  },
  // strictest realistic mobile baseline
  'mobile-worst': {
    deny: ['OES_texture_float_linear', 'OES_texture_float',
           'WEBGL_color_buffer_float', 'EXT_float_blend'],
    maxTextureSize: 4096,
  },
};

function clampContext(gl, profile) {
  const p = GPU_PROFILES[profile];
  if (!p) return gl;

  const realGetExtension = gl.getExtension.bind(gl);
  gl.getExtension = (name) => p.deny.includes(name) ? null : realGetExtension(name);

  const realGetParameter = gl.getParameter.bind(gl);
  gl.getParameter = (pname) => {
    if (p.maxTextureSize && pname === gl.MAX_TEXTURE_SIZE) return p.maxTextureSize;
    return realGetParameter(pname);
  };

  // CRITICAL: emulate incompleteness. Denying the extension is not enough on a
  // desktop driver that still filters float textures fine. Intercept texParameteri
  // and record which textures asked for LINEAR+FLOAT; assert on them in the probe.
  return gl;
}
```

The *critical* subtlety, and the reason naive extension-denial harnesses fail: denying
`getExtension` changes what the app *believes*, but the desktop driver will still happily
filter the float texture, so the sampler keeps returning correct data and **the bug does not
reproduce**. Two ways to close that gap:

**3.1a — Force real incompleteness (preferred).** Intercept `texImage2D`/`texParameteri`. When
a texture is `FLOAT` *and* has a `LINEAR` filter *and* the profile denies
`OES_texture_float_linear`, deliberately make it incomplete in a way every driver honors — set
`TEXTURE_MIN_FILTER` to `NEAREST_MIPMAP_LINEAR` (the default) on a texture with no mipmaps.
That is incomplete on **all** GL implementations and yields exactly the `(0,0,0,1)` fetch.

```js
const realTexParameteri = gl.texParameteri.bind(gl);
gl.texParameteri = (target, pname, param) => {
  if (denyFloatLinear && isFloatTexture(currentBinding(target))
      && (pname === gl.TEXTURE_MIN_FILTER || pname === gl.TEXTURE_MAG_FILTER)
      && param === gl.LINEAR) {
    // reproduce mobile incompleteness on a desktop driver
    if (pname === gl.TEXTURE_MIN_FILTER) {
      return realTexParameteri(target, pname, gl.NEAREST_MIPMAP_LINEAR);
    }
  }
  return realTexParameteri(target, pname, param);
};
```

**3.1b — Static audit (cheap, catches it without running).** A build-time or boot-time scan
that flags every `buildTexture(..., FLOAT, ..., LINEAR, ...)` call site and prints them. Zero
false negatives for this bug class.

Wire the profile via a URL param so it costs nothing to switch:
`index.html?gpu=samsung-a56`.

### 3.2 Tier 2 — ANGLE backend switching (~30 min, catches driver-class bugs)

Chrome on Windows can be forced onto different ANGLE backends. The A56 runs
`ANGLE ((Samsung Xclipse 540) on Vulkan 1.3.279)`; the desktop probe shows
`ANGLE (Microsoft Basic Render Driver, D3D11)`. Running desktop Chrome on the **Vulkan**
backend puts you on the same translation path as the phone:

```powershell
# Vulkan backend — same ANGLE path as the A56
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --use-angle=vulkan --use-cmd-decoder=passthrough `
  --user-data-dir="$env:TEMP\chrome-angle-vk" `
  "http://localhost:3000/?gpu=samsung-a56"

# SwiftShader — pure software GL, exposes anything relying on driver leniency
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --use-angle=swiftshader --user-data-dir="$env:TEMP\chrome-swsh" `
  "http://localhost:3000/"
```

Backends worth cycling: `d3d11`, `d3d9`, `gl`, `vulkan`, `swiftshader`. Different backends
enforce texture completeness with different strictness — `swiftshader` and `vulkan` are the
strict ones.

### 3.3 Tier 3 — real-device remote debugging (ground truth, keep in the loop)

Nothing above substitutes for the phone. Keep this available for verification:

```powershell
# Phone on USB, Developer Options + USB debugging on
adb devices
adb reverse tcp:3000 tcp:3000      # phone reaches the desktop dev server
# then open chrome://inspect on the desktop and inspect the phone's tab
```

`gulp serve` already runs BrowserSync on the dist dir; `adb reverse` makes it reachable from
the device without touching the network config.

### 3.4 Tier 4 — headless regression gate (CI)

Run the assertions of §3.1 under headless Chrome with `--use-angle=swiftshader` so the bug
class cannot come back silently. This is where the readback test belongs:

```js
// The test that would have found this in minutes.
function assertTextureRoundTrip(wgl, texture, w, h) {
  const known = new Float32Array(w * h * 4);
  for (let i = 0; i < known.length; ++i) known[i] = i + 1;   // deliberately non-zero
  // upload `known`, render a pass-through shader sampling at texel centers,
  // readPixels, assert bit-equality with `known`.
  // On a device without OES_texture_float_linear + LINEAR filter, this returns all zeros.
}
```

Run it against **every** simulation texture at boot, behind a `?selftest=1` flag. The existing
`runWebGLSelfTest` hook in `index.html:110` is the natural place to mount it.

---

## 4. Deliverable B — Shader/state quick fix

This is the recommended immediate action. It is small, low-risk, and reversible.

### 4.1 Fix 1 — point-sample the state textures (the actual fix)

In `brush.js`, change all six simulation textures from `LINEAR, LINEAR` to `NEAREST, NEAREST`:

```js
// brush.js:56-110 — all of:
//   positionsTexture, previousPositionsTexture, velocitiesTexture,
//   previousVelocitiesTexture, projectedPositionsTexture,
//   projectedPositionsTextureTemp, randomsTexture
this.positionsTexture = wgl.buildTexture(
  wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
  null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE,
  wgl.NEAREST, wgl.NEAREST          // <-- was LINEAR, LINEAR
);
```

**Risk: near zero.** As established in §1.2, every consumer except `splat.vert` samples at
exact texel centers, where `NEAREST` and `LINEAR` are numerically identical. This is a no-op
on desktop and the difference between working and not on mobile.

### 4.2 Fix 2 — handle the one path that genuinely interpolates

`splat.vert` fetches at `(vertex + 0.5 + t) / VERTICES_PER_BRISTLE` and relies on the hardware
to interpolate between bristle vertices. With `NEAREST` this snaps to the nearest vertex,
turning a smooth stroke into 18 stacked splats at the same point — visually a beaded stroke
rather than a continuous one.

Do the interpolation **explicitly in the shader**, which is both portable and more correct
(the hardware filter was interpolating in the wrong space anyway — it lerps positions, but you
want the lerp parameter to be exact):

```glsl
// splat.vert — replace the two direct fetches
uniform float u_verticesPerBristle;

vec3 sampleBristleLinear(sampler2D tex, vec2 uv) {
    float y = uv.y * u_verticesPerBristle - 0.5;
    float y0 = floor(y);
    float f  = y - y0;
    vec3 a = texture2D(tex, vec2(uv.x, (y0 + 0.5) / u_verticesPerBristle)).rgb;
    vec3 b = texture2D(tex, vec2(uv.x, (y0 + 1.5) / u_verticesPerBristle)).rgb;
    return mix(a, b, f);
}
```

Then `position = sampleBristleLinear(u_positionsTexture, a_splatCoordinates.xy);` and likewise
for `u_previousPositionsTexture`, `u_velocitiesTexture`, `u_previousVelocitiesTexture`.

Note this also requires vertex-shader texture fetch, which the A56 supports amply
(`MAX_VERTEX_TEXTURE_IMAGE_UNITS = 32` vs desktop's 16).

### 4.3 Fix 3 — relax the capability gate

`index.html:105` calls `wgl.hasFloatTextureSupport()`, which in `wrappedgl.js:431` requires
`OES_texture_float_linear`. After fixes 1 and 2 that requirement is obsolete — drop it:

```js
// wrappedgl.js:430
hasFloatTextureSupport() {
  if (this.getExtension('OES_texture_float') === null) return false;
  if (!this.canRenderToTexture(this.FLOAT)) return false;
  return true;
}
```

Keep `hasHalfFloatTextureSupport()` as the fallback tier for devices with no float rendering at
all (see §5.3).

### 4.4 Fix 4 — guard the degenerate-direction NaN

Independent of the above, `splat.vert` divides by a distance that is legitimately zero whenever
the brush is stationary (a held, un-moved stylus). Fix it regardless:

```glsl
float dist = distance(previousPlanarPosition, planarPosition);
vec2 direction = dist > 1e-6
    ? (planarPosition - previousPlanarPosition) / dist
    : vec2(1.0, 0.0);
```

The same class of guard already exists in `distanceconstraint.frag` (`max(currentDistance, 0.01)`)
and `bendingconstraint.frag` (`max(..., 0.0001)`), but `bendingconstraint.frag` still has two
unguarded divisions:

```glsl
vec3 r1 = (bPos - aPos) / distance(aPos, bPos);   // <-- unguarded
vec3 r2 = (cPos - bPos) / distance(bPos, cPos);   // <-- unguarded
```

Guard both. On a collapsed or coincident chain these produce `NaN`, and `NaN` propagates
through the whole texture on subsequent iterations. **On desktop these divisions are also
unguarded but never hit zero, because the chain never collapses. On mobile the collapse makes
them fire every frame — which is why the state is not merely zero but persistently poisoned.**

### 4.5 Fix 5 — remove the `mediump` hazard

`mediump` is 10-bit on the A56 vs 23-bit on desktop. Every brush shader already declares
`precision highp float;` — good. But `varying` declarations in `splat.vert` / `splat.frag`
inherit the fragment shader's default precision at the *fragment* stage. Since both files
declare `highp`, this is currently safe. **Do not let a future edit drop those declarations.**
Add a lint check to the gulp shader task asserting every `.frag`/`.vert` in `shaders/` starts
with `precision highp float;`.

For reference, at fp16/mediump the ulp at a canvas coordinate of 512 is **1.0** and at 1024 is
**1.0**, while the bristle segment spacing at `scale = 1` is **0.5** — i.e. the entire bristle
geometry would be unrepresentable. This is why `highp` is mandatory here and why it must be
enforced rather than assumed.

### 4.6 Verification

After 4.1–4.4:

1. `?gpu=samsung-a56` harness on desktop — bristles stand orthogonal, strokes land under the
   cursor across the whole canvas.
2. `--use-angle=swiftshader` — same.
3. Real A56 via `adb reverse` — same.
4. `?selftest=1` texture round-trip assertions all pass.

Expected effort: **half a day** including the harness.

---

## 5. Deliverable C — Framework / API migration

Migration is a *separate* decision from the bug fix. Do the fix first — it is half a day and
unblocks mobile immediately. Then consider migration on its own merits.

### 5.1 Recommendation: migrate to WebGL 2, not to a framework

Both probe files show `webgl2` present on desktop **and** on the A56. WebGL 2 is the right
target because it makes this entire bug class impossible:

| Problem today (WebGL 1) | WebGL 2 resolution |
|---|---|
| `OES_texture_float_linear` optional; absence silently zeroes fetches | Sized internal formats (`R32F`, `RGBA32F`) make the format explicit; `EXT_color_buffer_float` is the single gate. **Does not by itself prevent the zeroing** — see the correction below |
| No integer texture addressing | `texelFetch(tex, ivec2(x,y), 0)` — states exact-texel intent so the code cannot drift into accidental filtering. **Does not bypass texture completeness** |
| `gl_FragCoord.xy / u_resolution` round-trip | `texelFetch` with `ivec2(gl_FragCoord.xy)` — exact, no division, no half-texel reasoning |
| Ping-pong via framebuffer re-attachment per pass | Multiple render targets, transform feedback |
| `%`-style index math in float | Real integer ops in GLSL ES 3.00 |

**[CORRECTED 2026-09-07 — measured, not assumed]** This section originally claimed
`texelFetch` "alone would have made this bug unwritable". **That is wrong**, and the
measurement is worth recording so nobody relies on it.

Test: an `RGBA32F` texture with `TEXTURE_MIN/MAG_FILTER = LINEAR`, read both ways in
the same WebGL 2 shader:

```
texture(tex, uv)                   -> [0,0,0,1, 0,0,0,1, ...]   FAIL
texelFetch(tex, ivec2(uv*res), 0)  -> [0,0,0,1, 0,0,0,0, ...]   FAIL
```

With `NEAREST` on the same texture, both return the correct `[1,2,3,4,...]`.

Texture **completeness is a property of the texture object, not of the lookup
function.** An incomplete texture yields `vec4(0,0,0,1)` to *every* sampling
function, `texelFetch` included. WebGL 2 therefore provides **no structural
immunity** to this bug.

What actually prevents it — on both paths — is the NEAREST discipline plus the lint
that enforces it (§4.1, `npm run lint:shaders`). `texelFetch` is still worth having,
because it states exact-texel intent in the source so a future edit cannot silently
reintroduce filtered sampling of a state texture. That is a drift guarantee, not a
hardware one.

Every state-texture read in the PBD solver is an integer texel lookup wearing a
float-coordinate costume — and now says so explicitly.

**Migration cost:** moderate and mechanical.
- Add `#version 300 es` to all shaders; `attribute`→`in`, `varying`→`in`/`out`,
  `texture2D`→`texture`, `gl_FragColor`→a declared `out vec4`.
- Replace the state-texture reads with `texelFetch`.
- `wrappedgl.js` needs a WebGL2 context path; most of its API surface is unchanged.
- Keep the WebGL 1 path alive behind the §4 fixes as a fallback for old devices.

**Estimate:** 3–5 days, mostly mechanical, fully testable against the §3 harness.

### 5.2 What *not* to do

**Do not port to three.js / babylon.js / regl.** The prior attempts to "rewrite to some OpenGL
frameworks" failed for a structural reason worth stating: this application is not a scene
graph. It is a chain of ~15 fullscreen GPGPU passes with hand-managed ping-pong textures and
one instanced splat draw. General-purpose 3D engines add abstraction over exactly the layer
that needs to stay explicit, and they would not have prevented this bug — a three.js
`DataTexture` with `LinearFilter` on `FloatType` fails identically on the A56.

If you want a thin helper, `regl` or `twgl` are defensible (they are state-management sugar,
not scene graphs). But `wrappedgl.js` already *is* that layer, it is 30 KB, it is understood,
and it works. Replacing it buys nothing here.

**Do not target WebGPU yet** for the primary path. It is the right long-term answer — compute
shaders suit the PBD solver far better than fragment-shader GPGPU — but Safari/iOS support is
still uneven and the rewrite is a different order of magnitude (2–3 weeks). Revisit once the
WebGL 2 path is shipped and stable.

### 5.3 Optional resilience tier: half-float fallback

For the small remaining set of devices with no renderable-float support at all, note the A56
*does* expose `OES_texture_half_float_linear` and `EXT_color_buffer_half_float`. A half-float
fallback is viable **only** if positions are stored in a normalized brush-local space rather
than canvas pixels — as §4.5 shows, fp16 cannot represent bristle geometry at canvas-pixel
magnitudes. That means storing positions relative to the brush origin and adding the brush
position at splat time. This is real work (~2 days) and should only be undertaken if telemetry
shows a meaningful population that needs it. **Defer.**

---

## 6. Recommended sequence

| # | Action | Effort | Unblocks |
|---|---|---|---|
| 1 | §4.1 `NEAREST` on state textures | 15 min | **Mobile entirely** |
| 2 | §4.4 divide-by-zero guards in `splat.vert`, `bendingconstraint.frag` | 30 min | NaN poisoning |
| 3 | §4.2 explicit lerp in `splat.vert` | 1 h | Smooth strokes on mobile |
| 4 | §4.3 relax the capability gate | 15 min | Devices previously shown the error page |
| 5 | §3.1 capability-clamp harness + §3.4 readback selftest | 3 h | Desktop reproduction + regression gate |
| 6 | §4.5 shader precision lint | 30 min | Prevents recurrence |
| 7 | §5.1 WebGL 2 migration | 3–5 d | Makes the bug class structurally impossible |
| 8 | §5.3 half-float fallback | 2 d | Only if telemetry justifies |

Steps 1–4 are the fix. Steps 5–6 keep it fixed. Steps 7–8 are strategy.

---

## 7. Open questions

1. **~~Does the A56 currently reach the app at all?~~ RESOLVED.** **[CONFIRMED]**
   Under the honest `samsung-a56` profile the app did **not** start — it showed
   "your browser does not support WebGL floating point textures", because
   `hasFloatTextureSupport()` required `OES_texture_float_linear`.

   So a device in this class has **two** distinct failure modes, and which one
   you see depends on whether the gate is reached:
   - gate enforced → error page, app never runs;
   - gate bypassed → app runs, bristles collapse, only the origin corner paints.

   The reported field symptom is the second. Both are fixed: §4.1–4.2 make the
   simulation work without the extension, and §4.3 removes the gate that
   rejected the device.

2. **`u_resolution` vs viewport.** `brush.js` passes `u_resolution = (maxBristleCount,
   VERTICES_PER_BRISTLE)` while setting `viewport(0, 0, this.bristleCount,
   VERTICES_PER_BRISTLE)`. When `bristleCount < maxBristleCount` these disagree, and
   `gl_FragCoord.xy / u_resolution` addresses correctly only because both the texture and the
   divisor use `maxBristleCount`. This is correct as written but fragile — worth a comment.
   It is *not* the bug; it behaves identically on both platforms.

3. **~~Does the A56 tolerate `RGBA/FLOAT` render targets at all?~~ RESOLVED.**
   Yes. Confirmed on the physical device: the app boots and paints correctly with
   `RGBA/FLOAT` render targets and NEAREST filtering. The WebGL 1 path is viable
   as the long-term mobile path.

**No open questions remain for this bug.**
