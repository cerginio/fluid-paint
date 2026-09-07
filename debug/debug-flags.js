'use strict';

/*
 * Debug flags — one namespaced object, one source of truth, readable from the
 * URL so a phone can enable a probe without a rebuild.
 *
 *   ?debug=paintingRect              enable one
 *   ?debug=paintingRect,brushViewer  enable several
 *
 * These flags gate the debugging instrumentation described in
 * FLUID-ENGINE-EXTRACTION-PLAN.md §3a. That instrumentation is demoted behind
 * flags rather than deleted: it was built to make an invisible GPU problem
 * visible (see MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md), and that problem class
 * recurs.
 *
 * The contract a flag must honour: when it is off the feature is
 * STRUCTURALLY ABSENT — no GL programs compiled, no textures allocated, no
 * per-frame branches in the hot loop. A flag that costs frames when disabled
 * gets deleted by whoever profiles next, which puts us back where we started.
 * So read flags once at construction and branch there, never inside update().
 *
 * The older ?diag=1 / ?selftest=1 / ?gpu= switches predate this and keep their
 * own spelling; they are already flag-gated and are left alone.
 */

const DEBUG_FLAG_DEFAULTS = {
  paintingRect: false,   // the painting-rectangle outline overlay
  brushViewer: false,    // the live bristle preview panel
  depthRange: false,     // the +/-5000 orthographic depth-range probe
};

function parseDebugFlags(search) {
  const flags = Object.assign({}, DEBUG_FLAG_DEFAULTS);

  const raw = new URLSearchParams(
    search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '')
  ).get('debug');
  if (raw === null) return flags;

  for (const name of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      flags[name] = true;
    } else {
      console.warn('[debug] unknown flag:', name, '- known:', Object.keys(flags).join(', '));
    }
  }

  const on = Object.keys(flags).filter((k) => flags[k]);
  if (on.length) console.log('[debug] enabled:', on.join(', '));
  return flags;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEBUG_FLAG_DEFAULTS, parseDebugFlags };
}
