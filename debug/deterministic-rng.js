'use strict';

/*
 * Seedable RNG for reproducible runs.
 *
 * The simulation is already deterministic in every other respect: DELTA_TIME is
 * a fixed 1/60 (simulator.js:680), never a wall-clock delta, and the bristle
 * `randoms` texture is filled once in the Brush constructor rather than per
 * frame. So pinning Math.random is sufficient to make a scripted stroke produce
 * identical pixels every run -- which is what the golden-image harness needs.
 *
 * mulberry32: 32-bit state, uniform output, adequate for scattering bristles.
 * It is not a cryptographic generator and is not used as one.
 *
 * Usage:  index.html?seed=12345
 *
 * Installed before any other script that draws, so the Brush constructor sees
 * the seeded generator.
 */

function makeMulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * Replace Math.random with a seeded generator.
 *
 * Deliberately global: the call sites (brush.js:108, paint.js:202) are inside
 * constructors that take no options, and threading a generator through them
 * would be a behavioural change to production code in the phase whose whole
 * purpose is to change nothing. Reverting is a page reload.
 *
 * @returns {number} the seed actually applied
 */
function installDeterministicRandom(seed) {
  const applied = (seed >>> 0) || 1;
  if (!Math.random.__originalRandom) {
    const original = Math.random;
    const seeded = makeMulberry32(applied);
    seeded.__originalRandom = original;
    Math.random = seeded;
  }
  return applied;
}

/*
 * Read ?seed= and install if present. Returns the seed, or null when the
 * parameter is absent -- in which case Math.random is untouched and the app
 * behaves exactly as it always has.
 */
function maybeInstallDeterministicRandom(search) {
  const params = new URLSearchParams(search || window.location.search);
  const raw = params.get('seed');
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    console.warn('[rng] ignoring non-numeric seed:', raw);
    return null;
  }
  const applied = installDeterministicRandom(parsed);
  console.log('[rng] deterministic mode, seed =', applied);
  return applied;
}

if (typeof window !== 'undefined') {
  window.__fluidSeed = maybeInstallDeterministicRandom();
}
