# WebGL 2 dual path

WebGL 2 is the primary rendering path; the (fixed) WebGL 1 path is the automatic
fallback. Both run from **one set of shader sources**.

## How to select a path

```
index.html            WebGL 2 if available, else WebGL 1
index.html?webgl=1    force the WebGL 1 fallback
```

`wgl.isWebGL2` tells you which one you got. `?diag=1` reports it on-screen.

## One source, two backends

The 24 shaders in `shaders/` stay written in **GLSL ES 1.00**. Forking them into a
parallel ES 3.00 set would have meant 24 more files to keep in sync, and every
future edit made twice.

Instead `glsl3.js` translates at program-creation time. This works because every
shader source in the project funnels through `WrappedGL.createProgram()` — one
choke point.

What the translation does:

| GLSL ES 1.00 | GLSL ES 3.00 |
|---|---|
| `attribute` | `in` (vertex) |
| `varying` | `out` (vertex) / `in` (fragment) |
| `texture2D`, `textureCube` | `texture` |
| `texture2DLod` | `textureLod` |
| `gl_FragColor`, `gl_FragData[0]` | a declared `out vec4 fragColor` |
| — | `#version 300 es` first line, `precision highp int;` |

**Declaration order is the subtle part.** Callers prepend `#define` lines
(`'#define VELOCITY \n' + source`), and `#version` must be the very first line in
an ES 3.00 shader — so the two are reordered rather than concatenated. And
anything declaring a float must come *after* the source's own `precision` line,
or the shader is rejected with "No precision specified for (float)". The injected
declarations are therefore spliced in just past that line, not prepended.

## texelFetch2D

A shim written once in the ES 1.00 sources, expressed per backend:

```glsl
texelFetch2D(u_positionsTexture, coordinates, u_resolution)
```

| Backend | Becomes |
|---|---|
| WebGL 2 | `texelFetch(tex, ivec2(uv * resolution), 0)` |
| WebGL 1 | `texture2D(tex, uv)` — correct because the texture is NEAREST |

All 12 exact-texel reads in the PBD solver use it (`project`, `planeconstraint`,
`updatevelocity`, `setbristles`, `distanceconstraint`, `bendingconstraint`).

### What this does and does not buy you

**It does not make the mobile filtering bug impossible.** That was assumed in the
first draft of the migration plan and is **wrong** — measured:

```
RGBA32F texture with LINEAR filter, no float-linear support:
  texture(tex, uv)                 -> [0,0,0,1]   FAIL
  texelFetch(tex, ivec2(uv*r), 0)  -> [0,0,0,1]   FAIL
Same texture with NEAREST:
  both                             -> [1,2,3,4]   pass
```

Texture **completeness is a property of the texture object, not of the lookup
function**. An incomplete texture returns `vec4(0,0,0,1)` to every sampling
function, `texelFetch` included.

Run it yourself: `?gpu=samsung-a56-boots&selftest=1`.

What `texelFetch2D` *does* buy is a **drift guarantee**: the source now says
"exact texel, no filtering" explicitly, so a later edit cannot quietly
reintroduce filtered sampling of a state texture. The thing that actually
prevents the bug on both paths is the NEAREST discipline plus
`npm run lint:shaders`.

## Texture formats

WebGL 2 needs **sized internal formats** for float render targets — the unsized
`RGBA`/`FLOAT` pair WebGL 1 uses is not colour-renderable there.
`WrappedGL.internalFormatFor()` maps them in one place:

| format + type | WebGL 1 | WebGL 2 |
|---|---|---|
| `RGBA` + `FLOAT` | `RGBA` | `RGBA32F` |
| `RGB` + `FLOAT` | `RGB` | `RGB32F` |
| `RGBA` + `HALF_FLOAT` | `RGBA` | `RGBA16F` |

## Capability gates

| | WebGL 1 | WebGL 2 |
|---|---|---|
| float textures | `OES_texture_float` | core |
| render to float | `WEBGL_color_buffer_float` | `EXT_color_buffer_float` |
| float filtering | `OES_texture_float_linear` | **not required — do not use** |

`hasFloatTextureSupport()` checks the right one per path. Neither path requires
float-linear filtering; see the spec for why.

## Shader compile failures

They now **throw**, with a numbered listing of the *translated* source — the
driver reports line numbers of what it actually compiled, which does not line up
with the file on disk. Previously a failure was `console.log`'d and the app
carried on with a broken program.

## Test matrix

```powershell
npm run lint:shaders
```

then, per path:

| URL | Expect |
|---|---|
| `?selftest=1` | round-trip passes; immunity test reports which explanation holds |
| `?webgl=1` | WebGL 1 fallback, identical stroke |
| `?gpu=samsung-a56` | boots and paints on both paths |
| `?gpu=samsung-a56-boots&selftest=1` | LINEAR fails, NEAREST passes, on both lookups |
| `?gpu=mobile-worst` | correctly shows the unsupported page |
