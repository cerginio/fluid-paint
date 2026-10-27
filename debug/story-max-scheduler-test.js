'use strict';

// BudgetTickScheduler on a fake clock (SPEC 1.3): start K=16, the CPU budget,
// AIMD on display intervals, the 256 ceiling and re-estimation after a pause.
const assert = require('node:assert/strict');
const TilecraftStrokePlayer = require('../fluid-engine/tilecraft-stroke-player.js');

const { BudgetTickScheduler, FixedTickScheduler } = TilecraftStrokePlayer;

function harness(options = {}) {
  let time = 0;
  const scheduler = new BudgetTickScheduler({ now: () => time, ...options });
  return {
    scheduler,
    advance(ms) { time += ms; },
    /* One displayed frame: `interval` ms since the previous frame start, then
     * as many ticks as the scheduler grants, each costing `tickMs`. */
    frame(interval, tickMs = 0) {
      time += interval;
      scheduler.beginFrame();
      let ticks = 0;
      const start = time;
      while (scheduler.shouldContinue()) {
        ticks++;
        time += tickMs;
        if (ticks > 10000) throw new Error('scheduler never ended the frame');
      }
      scheduler.endFrame();
      time = start; // the next interval is measured from this frame's start
      return ticks;
    },
  };
}

{
  const h = harness();
  assert.equal(h.frame(0), 16, 'Max starts at 16 ticks per frame, never slower than 16x');
  for (let i = 0; i < 10; i++) assert.equal(h.frame(16), 16, 'K holds while D is calibrated');
  assert.equal(h.scheduler.displayInterval, 16, 'D is the median of the first ten intervals');
  assert.equal(h.frame(16), 17, 'a normal frame grows K by one');
  assert.equal(h.frame(16), 18);
}

{
  const h = harness();
  h.frame(0);
  for (let i = 0; i < 10; i++) h.frame(16);
  const before = h.scheduler.limit;
  h.frame(30); // > 1.5 D, first long frame: no change yet
  assert.equal(h.scheduler.limit, before, 'one long frame alone does not shrink K');
  h.frame(30);
  assert.equal(h.scheduler.limit, Math.floor(before * 0.7), 'two long frames in a row shrink K by 0.7');
  h.frame(30);
  assert.equal(h.scheduler.limit, Math.floor(before * 0.7), 'the streak restarts after a decrease');
  h.frame(16);
  assert.equal(h.scheduler.limit, Math.floor(before * 0.7) + 1, 'a normal frame grows K again');
}

{
  const h = harness();
  h.frame(0);
  for (let i = 0; i < 10; i++) h.frame(16);
  for (let i = 0; i < 400; i++) h.frame(16);
  assert.equal(h.scheduler.limit, 256, 'K is capped at 256');
  assert.equal(h.frame(16), 256);
}

{
  const h = harness();
  h.frame(0);
  for (let i = 0; i < 10; i++) h.frame(16);
  for (let i = 0; i < 20; i++) { h.frame(40); }
  assert.equal(h.scheduler.limit >= 1, true);
  for (let i = 0; i < 40; i++) h.frame(40);
  assert.equal(h.scheduler.limit, 1, 'K never drops below one tick per frame');
  assert.equal(h.frame(40), 1, 'one tick still runs, so playback always progresses');
}

{
  const h = harness();
  h.frame(0);
  assert.equal(h.frame(16, 1), 10, 'the 10 ms CPU budget ends a frame before K');
  assert.equal(h.frame(16, 50), 1, 'a tick longer than the budget still runs once per frame');
}

{
  const h = harness();
  h.frame(0);
  for (let i = 0; i < 10; i++) h.frame(16);
  for (let i = 0; i < 30; i++) h.frame(16);
  assert.ok(h.scheduler.limit > 16);
  h.frame(5000); // hidden tab or Pause: RAF stopped
  assert.equal(h.scheduler.limit, 16, 'K restarts at 16 after a suspension');
  assert.equal(h.scheduler.displayInterval, null, 'D is re-estimated after a suspension');
}

{
  const fixed = new FixedTickScheduler(3);
  fixed.beginFrame();
  const granted = [];
  for (let i = 0; i < 4; i++) granted.push(fixed.shouldContinue());
  assert.deepEqual(granted, [true, true, true, false], 'FixedTickScheduler grants exactly N');
  assert.throws(() => new FixedTickScheduler(0), TypeError);
}

// fluid-session phase 4: a session replay paces its heavy ticks by GPU fences.
{
  const { FenceTickScheduler } = require('../app/session-player.js');
  const done = new Set();
  let nextFence = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, TIMEOUT_EXPIRED: 2, ALREADY_SIGNALED: 3,
    fenceSync() { return nextFence++; },
    clientWaitSync(fence) { return done.has(fence) ? this.ALREADY_SIGNALED : this.TIMEOUT_EXPIRED; },
    deleteSync() {}, flush() {},
  };
  assert.equal(FenceTickScheduler.supported(gl), true);
  assert.equal(FenceTickScheduler.supported({}), false, 'WebGL1 falls back to BudgetTickScheduler');
  const scheduler = new FenceTickScheduler(gl, { now: () => 0 });
  const frame = () => {
    scheduler.beginFrame();
    let ticks = 0;
    while (scheduler.shouldContinue()) ticks++;
    scheduler.endFrame();
    return ticks;
  };
  assert.equal(frame(), 4, 'starts at 4 ticks');
  assert.equal(frame(), 4, 'a second batch may be in flight');
  assert.equal(frame(), 4, 'a third');
  assert.equal(frame(), 4, 'a fourth');
  assert.equal(frame(), 0, 'four batches pending: no ticks until the GPU catches up');
  assert.equal(frame(), 0, 'still pending');
  done.add(0);
  assert.equal(frame(), 2, 'a batch that had to be waited for shrinks the next to 0.7');
  done.add(1); done.add(2);
  assert.equal(frame(), 4, 'each batch done without a wait grows the limit by one (2 -> 3 -> 4)');
  assert.equal(new FenceTickScheduler(gl).depth, 4, 'depth 4: measured on the 890M and SwiftShader');
  scheduler.dispose();
  assert.equal(scheduler.fences.length, 0, 'dispose drops pending fences');
}

console.log('story max scheduler: PASS (start 16, budget, AIMD x0.7, ceiling 256, floor 1, suspension, fences)');
