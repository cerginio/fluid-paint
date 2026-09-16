'use strict';

/*
 * DebugToggles -- on-screen switches for the debug facilities
 * (debug/debug-flags.js), so they can be flipped without reloading with a
 * `?debug=` query string.
 *
 * The contract these must not break: a flag that's OFF means the feature is
 * STRUCTURALLY ABSENT (no GL programs, no textures, no per-frame branches --
 * see debug-flags.js). Hiding output instead of destroying it would still pay
 * the cost (brush.js's readback is the expensive part, not the drawing), so
 * each toggle CONSTRUCTS on enable and DESTROYS on disable through
 * host-supplied callbacks; the host's `!== null` checks stay unchanged. The
 * flags remain the source of truth for STARTING state (`?debug=-x` at load);
 * these toggles only change it afterwards.
 *
 * A toggle is a `{ id, label, get, set }` quad. `get()` reads the host's own
 * field (so a button can't drift from reality); `set(on)` constructs or
 * destroys. Button appearance is re-derived from `get()` after every change,
 * so a failed `set()` snaps back to the truth instead of showing a lie.
 */

class DebugToggles {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.element  container to mount the buttons into
   * @param {Array<{id:string,label:string,icon?:string,title?:string,
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
      btn.innerHTML = DebugToggles.iconMarkup(toggle.icon);
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', toggle.label);
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

  /** Small inline SVGs keep debug chrome compact without adding asset loads. */
  static iconMarkup(icon) {
    if (icon === 'brush') {
      return '<svg viewBox="0 0 8 8" aria-hidden="true" focusable="false">' +
        '<path d="M7.44.03c-.03 0-.04.02-.06.03l-3.75 2.66c-.04.03-.1.11-.13.16l-.13.25c.72.23 1.27.78 1.5 1.5l.25-.13c.05-.03.12-.08.16-.13l2.66-3.75c.03-.05.04-.09 0-.13l-.44-.44c-.02-.02-.04-.03-.06-.03zm-4.78 3.97c-.74 0-1.31.61-1.31 1.34 0 .99-.55 1.85-1.34 2.31.39.22.86.34 1.34.34 1.47 0 2.66-1.18 2.66-2.66 0-.74-.61-1.34-1.34-1.34z"/>' +
        '</svg>';
    }
    if (icon === 'bug') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path fill-rule="evenodd" clip-rule="evenodd" d="M17.3859 2.64323C17.7411 2.43012 17.8562 1.96943 17.6431 1.61424C17.43 1.25906 16.9693 1.14388 16.6141 1.35699L14.2687 2.76426C13.582 2.43471 12.8126 2.25011 12 2.25011C11.1874 2.25011 10.418 2.43471 9.73131 2.76426L7.38587 1.35699C7.03069 1.14388 6.56999 1.25906 6.35688 1.61424C6.14377 1.96943 6.25894 2.43012 6.61413 2.64323L8.37676 3.70081C7.37449 4.65692 6.75 6.00559 6.75 7.50011V7.79077C6.49339 7.92641 6.25088 8.08518 6.02526 8.2643C5.95652 8.19683 5.87356 8.14157 5.77854 8.10356L3.77854 7.30356C3.39396 7.14973 2.95748 7.33679 2.80364 7.72137C2.64981 8.10596 2.83687 8.54244 3.22146 8.69628L4.99257 9.40472C4.52263 10.1351 4.25 11.0045 4.25 11.9376V13.2501H2C1.58579 13.2501 1.25 13.5859 1.25 14.0001C1.25 14.4143 1.58579 14.7501 2 14.7501H4.25V15.0001C4.25 16.2791 4.55983 17.4858 5.10854 18.5491L3.22146 19.304C2.83687 19.4578 2.64981 19.8943 2.80364 20.2789C2.95748 20.6634 3.39396 20.8505 3.77854 20.6967L5.77854 19.8967C5.83233 19.8752 5.88225 19.8481 5.92792 19.8164C7.34764 21.6039 9.53996 22.7501 12 22.7501C14.46 22.7501 16.6524 21.6039 18.0721 19.8164C18.1177 19.8481 18.1677 19.8752 18.2215 19.8967L20.2215 20.6967C20.606 20.8505 21.0425 20.6634 21.1964 20.2789C21.3502 19.8943 21.1631 19.4578 20.7785 19.304L18.8915 18.5491C19.4402 17.4858 19.75 16.2791 19.75 15.0001V14.7501H22C22.4142 14.7501 22.75 14.4143 22.75 14.0001C22.75 13.5859 22.4142 13.2501 22 13.2501H19.75V11.9376C19.75 11.0045 19.4774 10.1351 19.0074 9.40472L20.7785 8.69628C21.1631 8.54244 21.3502 8.10596 21.1964 7.72137C21.0425 7.33679 20.606 7.14973 20.2215 7.30356L18.2215 8.10356C18.1264 8.14157 18.0435 8.19683 17.9747 8.2643C17.7491 8.08518 17.5066 7.92641 17.25 7.79077V7.50011C17.25 6.00559 16.6255 4.65692 15.6232 3.70081L17.3859 2.64323ZM5.75 15.0001V11.9376C5.75 10.1772 7.17709 8.75011 8.9375 8.75011H15.0625C16.8229 8.75011 18.25 10.1772 18.25 11.9376V15.0001C18.25 18.1981 15.8482 20.8351 12.75 21.2056V15.0001C12.75 14.5859 12.4142 14.2501 12 14.2501C11.5858 14.2501 11.25 14.5859 11.25 15.0001V21.2056C8.15183 20.8351 5.75 18.1981 5.75 15.0001ZM12 3.75011C14.0037 3.75011 15.6404 5.32165 15.7447 7.2994C15.522 7.26693 15.2942 7.25011 15.0625 7.25011H8.9375C8.70578 7.25011 8.47799 7.26693 8.25528 7.2994C8.35958 5.32165 9.99627 3.75011 12 3.75011Z"/>' +
        '</svg>';
    }
    return '<span class="debug-toggle-fallback" aria-hidden="true">D</span>';
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
