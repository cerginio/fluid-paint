# Interactive stroke timing — implemented contract

This replaces the proposed queue/resampling contract in commits 060f883 through
5ab3128. Those proposals were not implemented. They tried to solve a larger
problem than the interactive regression and contained contradictory overload
rules. Their history remains in Git.

## Scope and API

The main app and minimal host use `beginStroke({ timing: 'live', ... })`,
`strokeTo({ x, y, pressure })`, `advance(nowSeconds)`, and `endStroke()`.

The default `timing: 'replay'` retains the existing synchronous spatial replay
for compatibility with offline callers and Phase 9a probes. It is not suitable
for interactive input. Do not call `advance()` during a replay stroke, or mix
low-level stepping with the live clock.

Live painting restores time-based deposition, with the pre-9a 60 Hz behavior as
its reference. There is no arc-length queue, adaptive alpha, or stamp backlog.
The existing splat shader sweeps between bristle positions to cover each tick's
movement. Several input changes between advances collapse into the newest
position. Consequently very fast curves can lose intermediate detail: this
contract does not promise lossless event replay or identical output for arbitrary
callback grouping. Such a feature needs a separate design and tests.

## Clock

`advance(nowSeconds)` accepts a monotonic clock. It accumulates elapsed seconds,
counts complete 1/60-second ticks, discards all but the latest five if necessary,
then runs those ticks. A tick performs brush update, paint/velocity deposition
(if pressed), and fluid simulation, in that order. Fractional time remains.

The returned statistics include per-call steps and droppedSeconds, cumulative
simulatedSeconds and totalDroppedSeconds, accumulator, stamps, and
simulationUpdated. Within a clock epoch:

```
elapsed = simulatedSeconds + totalDroppedSeconds + accumulator
```

No more than five brush updates, five timed contacts, and five fluid steps run
per advance, regardless of distance or event count. There is no incomplete
spatial batch that can stall the clock. Overload loses physical time explicitly;
it cannot accumulate an unbounded work backlog.

A hidden document stops advancing. On visibility transitions the host calls
`resetClock(nowSeconds)` to discard suspended wall time and the fractional
remainder. Statistics count executed/dropped full ticks across epochs; reset
remainders and hidden time are outside the epoch invariant. No event timestamp
conversion is needed because input is a latest-state mailbox.

Brush physics remains in its existing units (displacement per fixed tick), and
its damping, gravity and padding coefficients stay unchanged. There is no
conversion to px/s that would multiply padding or impulse by 60. A variable-dt
brush integrator is not required when its caller enforces a fixed timestep.

## Input, contacts and presentation

- A live press initializes one fresh random bristle layout, copies its position
  history, clears old bristle velocities, and deposits one contact. It does not
  run a settling loop or advance fluid time. Even a sub-tick tap leaves pigment.
- `strokeTo()` validates and replaces one target. It performs no GPU work and
  allocates no queue proportional to distance or event count.
- During advance, targets are interpolated between the previous and current
  host sample for each due tick. After overload, the newest target is used.
- A held pointer continues to deposit once per tick and the fluid continues to
  move. After release, fluid steps continue without timed deposition.
- Release deposits a final swept contact if the endpoint has not been reached.
  This adds no physical time; the shader translates current geometry while
  retaining the prior position. The simulation rectangle covers the sweep.
- The app reads the dispatcher's current pointer position AND pressure before
  advance. Deferred gesture callbacks cannot leave that frame's target stale.
- Rendering adds the difference between the latest target and the physical
  brush anchor in the vertex shader. This updates the visible cursor even on a
  144 Hz frame containing no 60 Hz physical tick. It does not change textures,
  velocity or the physical state. The brush preview sets the same uniform.
- Point contacts handle zero-length segments in both splat shaders; the fragment
  shader must not divide by zero when the brush is stationary.

## Validation

`npm run test:timing` executes the real engine methods with recording GPU
substitutes. It checks 120 ticks during a two-second hold at 30/60/144 Hz,
constant-speed tick positions across those refresh rates, no GPU work for
10,000 input updates, one-step handling of a long move, sub-spacing presentation,
release endpoints, sub-tick taps, a three-second stall (5 ticks, 175 dropped),
and repeated clock resets.

`npm run test:live-gpu` runs one Chromium at a time under the browser lock,
on WebGL 2 and WebGL 1. It exercises the actual mouse dispatcher and RAF,
then checks finite pigment, a visible sub-tick tap, flow after release, and
different outcomes for fluidity 0.6 and 0.9 using repeatable brush layouts.
The GPU checks use SwiftShader and a 256x192 simulation for bounded test cost;
they do not certify a 16.7 ms frame budget on a physical GPU at 2048x2048.

Shader lint, color parity and the production build remain checks.
