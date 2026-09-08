'use strict';

/*
 * DebugToggles -- on-screen switches for the debug facilities.
 *
 * Until now the three debug features (debug/debug-flags.js) could only be
 * changed by reloading with a `?debug=` query string. That is fine on a desktop
 * and useless on the device where the instrumentation matters most: a phone,
 * where retyping a URL to see the bristle preview means losing the painting.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT THESE MUST NOT BREAK
 * ---------------------------------------------------------------------------
 *
 * debug-flags.js is explicit that a flag which is OFF means the feature is
 * STRUCTURALLY ABSENT -- no GL programs compiled, no textures allocated, no
 * per-frame branches in the hot loop. That is why the flags are read once at
 * construction and branched on there, never inside update().
 *
 * A toggle that merely hid the output would quietly convert that into "the
 * feature always runs, and we throw the pixels away" -- the readback in
 * brush.js is the expensive part, not the drawing, so hiding it would cost the
 * same as leaving it on. So each toggle here CONSTRUCTS on enable and DESTROYS
 * on disable, through callbacks the host supplies, and the host's per-frame
 * code keeps its existing `!== null` checks unchanged.
 *
 * The flags remain the source of truth for the STARTING state: `?debug=-x` is
 * still what decides whether a facility is on when the page loads. These
 * toggles change it afterwards.
 *
 * ---------------------------------------------------------------------------
 * What a toggle is
 * ---------------------------------------------------------------------------
 *
 * A `{ id, label, get, set }` quad. `get()` reports whether the facility is
 * currently live (the host reads its own field, so the button cannot drift out
 * of sync with reality); `set(on)` constructs or destroys it. The button's
 * appearance is derived from `get()` after every change rather than tracked
 * separately -- if `set()` fails, the button snaps back to the truth rather
 * than showing a lie.
 */

class DebugToggles {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.element  container to mount the buttons into
   * @param {Array<{id:string,label:string,title?:string,
   *                get:()=>boolean,set:(on:boolean)=>void}>} options.toggles
   */
  constructor({ element, toggles }) {
    this.element = element;
    this.toggles = toggles || [];
    this.buttons = new Map();

    for (const toggle of this.toggles) {
      const btn = document.createElement('div');
      // 'button-unselected' now; refresh() below sets the real state. The
      // class names are Buttons's (app/ui/buttons.js) so these pick up the
      // panel's existing styling rather than inventing a second look.
      btn.className = 'button-unselected debug-toggle';
      btn.textContent = toggle.label;
      if (toggle.title) btn.title = toggle.title;
      btn.setAttribute('data-debug-toggle', toggle.id);

      const onSelect = (event) => {
        // The panel's buttons use both click and touchstart; preventDefault on
        // the touch stops the synthesised click firing this twice, which would
        // toggle on and straight back off.
        event.preventDefault();
        this.set(toggle.id, !toggle.get());
      };
      btn.addEventListener('click', onSelect);
      btn.addEventListener('touchstart', onSelect);

      this.buttons.set(toggle.id, btn);
      element.appendChild(btn);
    }

    this.refresh();
  }

  /** Turn one facility on or off, then re-derive every button from reality. */
  set(id, on) {
    const toggle = this.toggles.find((t) => t.id === id);
    if (!toggle) return;

    try {
      toggle.set(on);
    } catch (e) {
      // A facility that throws while being built (a shader that will not
      // compile on this device, say) must not take the whole panel down with
      // it. Report and let refresh() show that it did not come on.
      console.error('[debug] toggle "' + id + '" failed:', e);
    }

    this.refresh();
  }

  /** Re-read every facility's real state and restyle its button to match. */
  refresh() {
    for (const toggle of this.toggles) {
      const btn = this.buttons.get(toggle.id);
      if (!btn) continue;
      const on = !!toggle.get();
      btn.className = (on ? 'button-selected' : 'button-unselected') + ' debug-toggle';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DebugToggles };
}
