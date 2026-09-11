'use strict';

// The focus cue is DOM rather than a framebuffer pass so it can follow a zoom
// pointer anywhere, including outside the canvas and painting bounds.
class FocusOverlay {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.root = document.getElementById('app') || document.body;
    this.element = document.createElement('div');
    this.element.className = 'focus-overlay';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path fill="currentColor" fill-rule="evenodd"
          d="M1 7V1h6v1H2v5H1zm10-6h6v6h-1V2h-5V1zM1 11h1v5h5v1H1v-6zm15 0h1v6h-6v-1h5v-5zM9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
      </svg>`;
    this.root.appendChild(this.element);
  }

  draw(focus) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const css = this.viewport.screenToCss(focus.x, focus.y);
    this.element.style.left = `${canvasRect.left - rootRect.left + css.x}px`;
    this.element.style.top = `${canvasRect.top - rootRect.top + css.y}px`;
    this.element.classList.add('is-visible');
  }

  hide() {
    this.element.classList.remove('is-visible');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FocusOverlay };
}
