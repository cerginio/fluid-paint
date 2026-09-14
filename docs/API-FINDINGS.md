# API findings from Phase 9

Phase 9's rule, from `docs/FLUID-ENGINE-EXTRACTION-PLAN.md`:

> A minimal second host: a bare canvas, `new FluidEngine(canvas)`, three
> controls. No panel, no picker. **If this host needs anything the API does not
> expose, the API is wrong — and that is the point of building it.**

This is the record of what it needed. The host is `examples/minimal/`; the probe
that drives it is `debug/phase9-probe.js`.

Three findings. All three were **invisible while there was one host** — the app
supplied each of them by accident, so nothing in four phases of extraction could
have caught them. That is the argument for having built the second host at all.

---

## Finding 1 — `Brush.update()` read an app-owned global, and threw without one

**Severity: a bug, not a gap.** This one silently broke painting entirely.

`fluid-engine/brush.js` ended `update()` with a debug hook:

```js
if (presenter) {
  presenter.presentTextureToCanvas2D({ srcTexture: ..., debugCanvas, ... });
}
```

`presenter` is declared by `index.html` (`let presenter;`) and assigned only when
the `textureProbe` debug flag is on. Inside that page a bare `if (presenter)` is
a safe undefined test, which is why it read as harmless for four phases.

In any other host the identifier is **never declared**, and reading an undeclared
name is a `ReferenceError`.

The failure shape is the worst available:

- it throws inside `update()`, which runs **every frame of every stroke**
- the throw unwinds before `splat()` is reached, so **nothing is ever deposited**
- the canvas, the controls, and every capability probe look perfectly healthy

Which is exactly how `examples/minimal` presented: boots fine, 0 splat calls,
`canDepositPaint: true`, an empty paint texture, no visible cause. This is the
same failure signature as the iPhone 14 bug and the synthetic-`PointerEvent` gap
— healthy-looking app, nothing painted — and it is the third time this project
has hit it.

**Fixed** in `fluid-engine/brush.js`: `typeof presenter !== 'undefined' &&
presenter`. `typeof` is defined for undeclared identifiers, so the engine asks
"is there a presenter" without requiring a host to declare one.

**The general rule this establishes:** the engine must not read a bare global its
host never heard of. There is now exactly one such read left and it is guarded;
if another appears, it will be caught by this probe, or by a user.

---

## Finding 2 — the engine did not publish its colour-model enum

`renderToTexture({ colorModel })` has always been an engine parameter. But:

- the renderer compared it against a **private** `const ColorModelRGB = 1`
  (`fluid-engine/renderer.js`)
- the only **public name** for the two values lived in the **app's**
  `paint-setup.js`, as `ColorModel = { RYB: 0, RGB: 1 }`

So a second host had three options, all bad: import a chunk of the app it does
not otherwise want, pass a bare literal, or guess.

The reason this matters more than it looks: the renderer's test is an equality,
and **everything that fails it falls through to RYB**. A host that passed
`'rgb'`, or `true`, or `1.0` from a parsed string, would get the protected
subtractive model with no error at any layer — a wrong picture and a silent one.

**Fixed:** `FluidEngine.COLOR_MODEL = { RYB: 0, RGB: 1 }`, published on the class
because a host needs it before an instance exists.

`renderer.js` still declares its own literal, because this project has no module
system and `renderer.js` loads before `index.js`. So `index.js` now **asserts at
load** that the two agree, and throws if they do not — a comment promising they
match is not worth the line it occupies.

---

## Finding 3 — the engine did not publish its own shader manifest

The engine loads no shaders itself; the host fetches them and hands back a
`shaderSources` object. That division is right — a host may bundle, inline, or
serve from anywhere the engine cannot guess.

What was wrong is that the **list of which files** lived in the app's
`common.js`, as `ENGINE_SHADERS`. So hosting the engine meant carrying an
inventory of **nineteen of the engine's own internal filenames** — a list with no
reason to be in a host, that goes stale the moment a pass is added to the
simulation, and whose failure mode is a shader compiled from `undefined` deep
inside a constructor rather than a named error.

**Fixed:** `FluidEngine.SHADER_FILES`, the frozen manifest, on the class.

The app now reads the same list every other host does. That required one change
with a trap in it: `SHADER_TREES` in `common.js` became the **function**
`shaderTrees()`, because `common.js` is loaded *before* `fluid-engine/index.js`
and a top-level `FluidEngine.SHADER_FILES` would evaluate to `undefined`. The
comment there says so; do not simplify it back to a constant.

The engine still says only **which**; the host still says **where** (the base
path). That is the split, and it survived the change.

---

## What the second host did NOT need — the parts of the API that held

Worth recording, because it is the other half of the result. Writing a working
host required none of:

- `engine.simulator` / `engine.brush` / `engine.renderer`. The Phase 5 rule held.
  The probe checks this at runtime as well as by grep, because an example that
  reaches past the API is a licence, not a demonstration.
- any of `viewport.js`, `colorpicker.js`, `slider.js`, `buttons.js`,
  `panel.js`, `pointer-dispatcher.js`, `paint-setup.js`, `common.js`, or
  `debug/*`.
- any shader from `app/shaders/`. The Phase 4 tree split is real: the engine
  reaches for nothing on the app side.

And three pieces of the surface earned themselves:

- **`engine.capabilities.canDepositPaint`** — the host acts on it and fails
  loudly, instead of showing a canvas that cannot be painted on.
- **`engine.fluidity`** as a getter — the host's slider initialises *from* the
  engine, so a control cannot start out disagreeing with the simulation.
- **`renderToTexture()` taking the target as an argument** rather than caching
  it. That is precisely why one renderer serves the screen, the save path, and
  this page. It was the Phase 4 note's prediction, and it paid.

---

## Still open, and deliberately not done here

**The named stroke API (`beginStroke` / `strokeTo` / `endStroke`) — Phase 9a.**

The plan says to build the host first if the host and the proposed API disagree
about the shape. They do not disagree; the host confirms the need. Writing
`examples/minimal` required the integrator to know, from prose rather than from
the API:

1. that `initializeBrush()` must precede the first `positionBrush()`, or the
   bristles drag in from wherever they last were and lay a tail;
2. that bristles need settling frames before anything deposits;
3. that the spacing of `positionBrush()` calls **is** the stroke dynamics,
   because speed is derived from the delta and not from elapsed time;
4. that colour must arrive as RYB, converted at the boundary.

This host gets (1) and (3) right because it drives from live pointer events at
frame rate, which is the easy case. A caller replaying recorded vector art — the
tilecraft use case in `docs/api-usecases.md` — has none of that structure handed
to it, and every one of the four is silent when got wrong.

So Phase 9a stands as specified, and the per-press bristle re-seed from Phase 8a
belongs inside `beginStroke()`.
