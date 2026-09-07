'use strict';

/*
 * On-screen device diagnostic panel.
 *
 * A phone has no console, so ?diag=1 renders the capability report and the
 * texture round-trip result directly onto the page.
 *
 * See docs/DEVICE-VERIFICATION.md
 */

function showDeviceDiagnostics(wgl) {
  const gl = wgl ? wgl.gl : null;

  const panel = document.createElement('div');
  panel.id = 'device-diag';
  panel.style.cssText = [
    'position:fixed', 'left:0', 'top:0', 'z-index:99999',
    'max-width:100%', 'max-height:60%', 'overflow:auto',
    'background:rgba(12,12,16,0.94)', 'color:#e8e8ea',
    'font:12px/1.55 ui-monospace,Menlo,Consolas,monospace',
    'padding:10px 12px', 'border-bottom-right-radius:8px',
    '-webkit-user-select:text', 'user-select:text',
  ].join(';');

  const rows = [];
  const add = (label, value, verdict) => {
    // verdict: 'good' | 'bad' | 'expected' | undefined
    const color =
      verdict === 'good' ? '#3ddc84' :
      verdict === 'bad' ? '#ff5c5c' :
      verdict === 'expected' ? '#ffc14d' : '#e8e8ea';
    rows.push(
      '<div><span style="opacity:.65">' + label + '</span> ' +
      '<b style="color:' + color + '">' + value + '</b></div>'
    );
  };

  if (!gl) {
    add('WebGL', 'UNAVAILABLE', 'bad');
  } else {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(masked)';

    const hasFloat = wgl.isWebGL2
      ? !!gl.getExtension('EXT_color_buffer_float')   // core textures, this gates rendering
      : !!gl.getExtension('OES_texture_float');
    const hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');
    const gate = wgl.hasFloatTextureSupport();

    rows.push('<div style="font-weight:700;margin-bottom:4px">fluid-paint device diagnostics</div>');
    rows.push('<div style="opacity:.55;word-break:break-all;margin-bottom:6px">' + renderer + '</div>');

    add('context', wgl.isWebGL2 ? 'WebGL 2' : 'WebGL 1 (fallback)',
        wgl.isWebGL2 ? 'good' : 'expected');
    add(wgl.isWebGL2 ? 'EXT_color_buffer_float' : 'OES_texture_float',
        String(hasFloat), hasFloat ? 'good' : 'bad');
    add('OES_texture_float_linear', String(hasFloatLinear),
        hasFloatLinear ? 'good' : 'expected');
    add('hasFloatTextureSupport()', String(gate), gate ? 'good' : 'bad');

    // Blending into a FLOAT render target -- the exact path Simulator.splat()
    // takes into paintTexture, which is always FLOAT. A device that cannot do
    // this shows a brush that moves and bristles that touch the canvas while
    // the canvas stays blank, because the draw is dropped rather than failing.
    // Reported for iPhone 14, 2026-09-07; see docs/HANDOFF.md.
    add('EXT_float_blend', String(!!gl.getExtension('EXT_float_blend')),
        gl.getExtension('EXT_float_blend') ? 'good' : 'bad');
    if (typeof floatBlendRoundTrip === 'function') {
      try {
        const fb = floatBlendRoundTrip(gl);
        add('&nbsp;blend into FLOAT target',
            fb.pass ? 'PASS' : ('FAIL' + (fb.value !== null ? ' (got ' + fb.value.toFixed(3) + ', want 0.5)' : '')),
            fb.pass ? 'good' : 'bad');
        if (!fb.pass) {
          rows.push('<div style="color:#ff5c5c">&nbsp;&nbsp;splatting cannot deposit paint on this device</div>');
          if (fb.error) rows.push('<div style="color:#ff5c5c;opacity:.8">&nbsp;&nbsp;' + fb.error + '</div>');
        }
      } catch (e) {
        add('&nbsp;blend into FLOAT target', 'ERROR: ' + e.message, 'bad');
      }
    }
    add('MAX_TEXTURE_SIZE', gl.getParameter(gl.MAX_TEXTURE_SIZE));
    add('devicePixelRatio', window.devicePixelRatio);

    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    add('highp fragment precision', hp ? hp.precision + ' bits' : '(n/a)',
        hp && hp.precision >= 23 ? 'good' : 'bad');

    // The decisive test: the sampling path the app actually uses.
    if (hasFloat && typeof textureRoundTrip === 'function') {
      rows.push('<div style="margin-top:6px;opacity:.65">texture round-trip</div>');
      try {
        const near = textureRoundTrip(gl, 32, 8, gl.NEAREST);
        add('&nbsp;FLOAT + NEAREST', near.pass ? 'PASS' : 'FAIL',
            near.pass ? 'good' : 'bad');
        if (!near.pass) {
          rows.push('<div style="color:#ff5c5c">&nbsp;&nbsp;the app CANNOT work on this device</div>');
        }

        const lin = textureRoundTrip(gl, 32, 8, gl.LINEAR);
        add('&nbsp;FLOAT + LINEAR', lin.pass ? 'PASS' : (lin.allZero ? 'FAIL (all zero)' : 'FAIL'),
            lin.pass ? 'good' : 'expected');
        if (!lin.pass) {
          rows.push(
            '<div style="opacity:.6">&nbsp;&nbsp;expected on mobile; nothing samples this way now</div>'
          );
        }
      } catch (e) {
        add('&nbsp;round-trip', 'ERROR: ' + e.message, 'bad');
      }
    }

    rows.push(
      '<div style="margin-top:8px;opacity:.6">Now draw a stroke. Paint should appear ' +
      'under your finger anywhere on the canvas, with visible bristles.</div>'
    );
  }

  const close = '<div style="margin-top:8px"><button id="device-diag-close" ' +
    'style="font:inherit;padding:4px 10px">close</button></div>';

  panel.innerHTML = rows.join('') + close;
  document.body.appendChild(panel);
  const btn = document.getElementById('device-diag-close');
  if (btn) btn.addEventListener('click', () => panel.remove());
}

if (typeof window !== 'undefined') {
  window.showDeviceDiagnostics = showDeviceDiagnostics;
}
