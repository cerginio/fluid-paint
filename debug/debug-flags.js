'use strict';

/*
 * Debug flags — one namespaced object, one source of truth, readable from the
 * URL so a phone can change a probe without a rebuild.
 *
 * These gate the debugging instrumentation described in
 * FLUID-ENGINE-EXTRACTION-PLAN.md §3a. That instrumentation is DECOMPOSED, not
 * removed and not switched off: every flag here defaults to ON, so the default
 * configuration behaves exactly as it always has. The flags exist to give each
 * feature its own module and a declared seam in the engine's API, so that the
 * debug tooling stops being entangled with Paint and stops being a drag on
 * extracting the engine.
 *
 * Because the defaults are on, the syntax has to express both directions:
 *
 *   ?debug=-paintingRect              turn one off
 *   ?debug=-paintingRect,-brushViewer turn several off
 *   ?debug=none                       turn everything off
 *   ?debug=paintingRect               turn one on (explicit; already on)
 *   ?debug=only:paintingRect          that one on, everything else off
 *
 * The contract a flag must honour when it IS off: the feature is STRUCTURALLY
 * ABSENT — no GL programs compiled, no textures allocated, no per-frame
 * branches in the hot loop. The off path is rarely taken, which is exactly why
 * it has to be real rather than a per-frame `if`. So read flags once at
 * construction and branch there, never inside update().
 *
 * The older ?diag=1 / ?selftest=1 / ?gpu= switches predate this and keep their
 * own spelling; they are already gated and are left alone.
 */

const DEBUG_FLAG_DEFAULTS = {
  paintingRect: true,    // the painting-rectangle outline overlay
  brushViewer: true,     // the live bristle preview panel
};

function parseDebugFlags(search) {
  const flags = Object.assign({}, DEBUG_FLAG_DEFAULTS);
  const known = Object.keys(flags);

  const raw = new URLSearchParams(
    search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '')
  ).get('debug');
  if (raw === null) return flags;

  const tokens = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const setAll = (v) => { for (const k of known) flags[k] = v; };

  for (const token of tokens) {
    if (token === 'none' || token === 'off') { setAll(false); continue; }
    if (token === 'all' || token === 'on') { setAll(true); continue; }

    // `only:x` — x on, everything else off.
    if (token.startsWith('only:')) {
      const name = token.slice('only:'.length);
      if (!Object.prototype.hasOwnProperty.call(flags, name)) {
        console.warn('[debug] unknown flag:', name, '- known:', known.join(', '));
        continue;
      }
      setAll(false);
      flags[name] = true;
      continue;
    }

    const off = token.startsWith('-') || token.startsWith('!');
    const name = off ? token.slice(1) : token;
    if (!Object.prototype.hasOwnProperty.call(flags, name)) {
      console.warn('[debug] unknown flag:', name, '- known:', known.join(', '));
      continue;
    }
    flags[name] = !off;
  }

  const disabled = known.filter((k) => !flags[k]);
  if (disabled.length) console.log('[debug] disabled:', disabled.join(', '));
  return flags;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEBUG_FLAG_DEFAULTS, parseDebugFlags };
}
