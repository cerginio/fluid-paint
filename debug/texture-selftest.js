'use strict';

/*
 * Texture round-trip self-test.
 *
 * The test that would have found the mobile bristle-collapse bug in minutes:
 * write a known non-zero pattern into a texture, sample it at exact texel
 * centers through a pass-through shader, read it back, assert equality.
 *
 * On a GPU without OES_texture_float_linear, a FLOAT texture with a LINEAR
 * filter is texture-incomplete and every fetch returns vec4(0,0,0,1) -- so the
 * readback is all zeros and this test fails loudly.
 *
 * Usage:  index.html?selftest=1
 */

const SELFTEST_VS = `
precision highp float;
attribute vec2 a_position;
void main () { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const SELFTEST_FS = `
precision highp float;
uniform vec2 u_resolution;
uniform sampler2D u_texture;
void main () {
    // Exact texel centers -- identical under NEAREST and LINEAR when the
    // texture is complete.
    vec2 coordinates = gl_FragCoord.xy / u_resolution;
    gl_FragColor = texture2D(u_texture, coordinates);
}
`;

function compileSelfTestProgram(gl) {
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('selftest shader compile failed: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, SELFTEST_VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, SELFTEST_FS));
  gl.bindAttribLocation(p, 0, 'a_position');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('selftest program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/*
 * Round-trip one texture configuration.
 *
 * @param filter  gl.LINEAR or gl.NEAREST -- the filter under test
 * @returns {{pass, maxError, allZero, readback, expected}}
 */
function textureRoundTrip(gl, width, height, filter) {
  const expected = new Float32Array(width * height * 4);
  for (let i = 0; i < expected.length; ++i) {
    expected[i] = i + 1; // deliberately non-zero, so a zeroed fetch is unmistakable
  }

  // Source texture holding the known pattern.
  const src = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, expected);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

  // Destination we render into and read back from (always NEAREST -- the
  // render target's own filter is irrelevant to the test).
  const dst = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dst);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    return { pass: false, reason: 'framebuffer incomplete: 0x' + status.toString(16) };
  }

  const program = compileSelfTestProgram(gl);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  gl.useProgram(program);
  gl.viewport(0, 0, width, height);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const readback = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, readback);

  let maxError = 0;
  let allZero = true;
  for (let i = 0; i < expected.length; ++i) {
    maxError = Math.max(maxError, Math.abs(readback[i] - expected[i]));
    if (readback[i] !== 0) allZero = false;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(src);
  gl.deleteTexture(dst);
  gl.deleteBuffer(quad);
  gl.deleteProgram(program);

  return { pass: maxError === 0, maxError, allZero, readback, expected };
}

/*
 * Run the full suite. Dimensions match the real brush simulation textures:
 * maxBristleCount x VERTICES_PER_BRISTLE.
 */
function runTextureSelfTest(gl, opts) {
  opts = opts || {};
  const width = opts.width || 128;   // typical maxBristleCount
  const height = opts.height || 10;  // VERTICES_PER_BRISTLE

  const results = [];

  const hasFloat = !!gl.getExtension('OES_texture_float');
  const hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');

  console.group('%c[selftest] texture round-trip', 'font-weight:bold');
  console.log('OES_texture_float        : %s', hasFloat);
  console.log('OES_texture_float_linear : %s', hasFloatLinear);

  if (!hasFloat) {
    console.error('No OES_texture_float -- float simulation is impossible on this device.');
    console.groupEnd();
    return [{ name: 'OES_texture_float', pass: false, reason: 'extension absent' }];
  }

  for (const [name, filter] of [['NEAREST', gl.NEAREST], ['LINEAR', gl.LINEAR]]) {
    let r;
    try {
      r = textureRoundTrip(gl, width, height, filter);
    } catch (e) {
      r = { pass: false, reason: e.message };
    }
    r.name = 'FLOAT ' + width + 'x' + height + ' + ' + name;
    results.push(r);

    if (r.pass) {
      console.log('%c PASS %c %s', 'background:#2a2;color:#fff', '', r.name);
    } else if (r.allZero) {
      console.error(
        ' FAIL  %s -- readback is ALL ZEROS.\n' +
          '        The texture is incomplete: a FLOAT texture with a %s filter\n' +
          '        requires OES_texture_float_linear, which this GPU lacks.\n' +
          '        Every texture2D() fetch returns vec4(0,0,0,1).\n' +
          '        THIS IS THE BRISTLE-COLLAPSE BUG.',
        r.name, name
      );
    } else {
      console.error(' FAIL  %s -- maxError=%s reason=%s', r.name, r.maxError, r.reason || '(mismatch)');
    }
  }

  console.groupEnd();
  return results;
}

if (typeof window !== 'undefined') {
  window.runTextureSelfTest = runTextureSelfTest;
  window.textureRoundTrip = textureRoundTrip;
}
