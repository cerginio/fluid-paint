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
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' &&
              gl instanceof WebGL2RenderingContext;
  const vsSrc = gl2 ? GLSL3.toES3(SELFTEST_VS, 'vertex') : SELFTEST_VS;
  const fsSrc = gl2 ? GLSL3.toES3(SELFTEST_FS, 'fragment') : SELFTEST_FS;
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
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
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
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' &&
              gl instanceof WebGL2RenderingContext;
  const internal = gl2 ? gl.RGBA32F : gl.RGBA;

  const src = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.FLOAT, expected);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

  // Destination we render into and read back from (always NEAREST -- the
  // render target's own filter is irrelevant to the test).
  const dst = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dst);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.FLOAT, null);
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

  // Float textures are core in WebGL 2 (gated on EXT_color_buffer_float for
  // rendering); the OES extensions only exist on WebGL 1.
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' &&
                gl instanceof WebGL2RenderingContext;
  const hasFloat = isGL2
    ? !!gl.getExtension('EXT_color_buffer_float')
    : !!gl.getExtension('OES_texture_float');
  const hasFloatLinear = !!gl.getExtension('OES_texture_float_linear');

  console.group('%c[selftest] texture round-trip', 'font-weight:bold');
  console.log('context                  : %s', isGL2 ? 'WebGL 2' : 'WebGL 1');
  console.log('float render targets     : %s', hasFloat);
  console.log('float linear filtering   : %s', hasFloatLinear);

  if (!hasFloat) {
    console.error('No renderable float textures -- the simulation cannot run here.');
    console.groupEnd();
    return [{ name: 'float render targets', pass: false, reason: 'unsupported' }];
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

  if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
    testTexelFetchImmunity(gl);
  }

  return results;
}


/*
 * Does texelFetch bypass texture incompleteness? (WebGL 2 only)
 *
 * MEASURED ANSWER: no. Completeness is a property of the texture object, not of
 * the lookup function -- an incomplete texture returns vec4(0,0,0,1) to every
 * sampling function, texelFetch included.
 *
 * This is kept as a runnable check because the opposite is widely assumed (it
 * was assumed in the first draft of the migration spec). What actually prevents
 * the bug on both paths is the NEAREST discipline plus debug/lint-shaders.js.
 */
function testTexelFetchImmunity(gl) {
  const NL = String.fromCharCode(10);
  if (typeof WebGL2RenderingContext === 'undefined' ||
      !(gl instanceof WebGL2RenderingContext)) {
    return { skipped: 'not a WebGL 2 context' };
  }
  gl.getExtension('EXT_color_buffer_float');

  const W = 8, H = 4;
  const expected = new Float32Array(W * H * 4);
  for (let i = 0; i < expected.length; ++i) expected[i] = i + 1;

  function readBack(filter, mode) {
    const src = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, expected);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fetch = mode === 'texelFetch'
      ? 'texelFetch(t, ivec2(uv * r), 0)'
      : 'texture(t, uv)';
    const vs = [
      '#version 300 es',
      'in vec2 a_position;',
      'void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }',
    ].join(NL);
    const fs = [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      'out vec4 o;',
      'uniform sampler2D t;',
      'uniform vec2 r;',
      'void main(){ vec2 uv = gl_FragCoord.xy / r; o = ' + fetch + '; }',
    ].join(NL);

    const sh = (type, source) => {
      const s2 = gl.createShader(type);
      gl.shaderSource(s2, source); gl.compileShader(s2);
      if (!gl.getShaderParameter(s2, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s2));
      }
      return s2;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'a_position');
    gl.linkProgram(prog);

    const dst = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    gl.useProgram(prog);
    gl.viewport(0, 0, W, H);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'r'), W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const out = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, out);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo); gl.deleteTexture(src); gl.deleteTexture(dst);
    gl.deleteBuffer(quad); gl.deleteProgram(prog);

    let ok = true;
    for (let i = 0; i < expected.length; ++i) if (out[i] !== expected[i]) ok = false;
    return { pass: ok, first4: Array.from(out.slice(0, 4)) };
  }

  const result = {
    linear_texture: readBack(gl.LINEAR, 'texture'),
    linear_texelFetch: readBack(gl.LINEAR, 'texelFetch'),
    nearest_texture: readBack(gl.NEAREST, 'texture'),
    nearest_texelFetch: readBack(gl.NEAREST, 'texelFetch'),
  };
  result.texelFetchGivesImmunity = result.linear_texelFetch.pass;

  console.group('%c[selftest] does texelFetch bypass incompleteness?', 'font-weight:bold');
  console.log('LINEAR  + texture()    :', result.linear_texture.pass ? 'pass' : 'FAIL', result.linear_texture.first4);
  console.log('LINEAR  + texelFetch() :', result.linear_texelFetch.pass ? 'pass' : 'FAIL', result.linear_texelFetch.first4);
  console.log('NEAREST + texture()    :', result.nearest_texture.pass ? 'pass' : 'FAIL', result.nearest_texture.first4);
  console.log('NEAREST + texelFetch() :', result.nearest_texelFetch.pass ? 'pass' : 'FAIL', result.nearest_texelFetch.first4);
  console.log(result.texelFetchGivesImmunity
    ? 'texelFetch DOES bypass incompleteness on this driver (unexpected).'
    : 'texelFetch does NOT bypass incompleteness -- NEAREST is what protects us.');
  console.groupEnd();

  return result;
}

/*
 * Can this device ALPHA-BLEND into a FLOAT render target?
 *
 * This is the exact path Simulator.splat() uses: it enables BLEND with
 * SRC_ALPHA / ONE_MINUS_SRC_ALPHA and renders into paintTexture, which is
 * always FLOAT (unlike the velocity/pressure targets, which fall back to
 * half-float). Blending into a float target is gated by EXT_float_blend, and
 * an implementation that lacks it is entitled to fail the draw silently --
 * which looks exactly like "the brush moves, the bristles touch the canvas,
 * and the canvas stays white".
 *
 * Checking for the extension is not enough on its own: WebGL 2 implementations
 * may expose blending behaviour without advertising it, and some advertise it
 * while still misbehaving. So this actually does the blend and reads back.
 *
 * Method: clear the target to 0, then draw a full-coverage quad of
 * colour (1,1,1,1) with alpha 0.5 blending. The correct result is 0.5.
 *
 * @returns {{pass: boolean, value: number|null, extension: boolean, error: string|null}}
 */
function floatBlendRoundTrip(gl) {
  const gl2 = typeof WebGL2RenderingContext !== 'undefined' &&
              gl instanceof WebGL2RenderingContext;
  const out = {
    pass: false,
    value: null,
    extension: !!gl.getExtension('EXT_float_blend'),
    error: null,
  };

  // The float-renderable extensions must be enabled before a float target works.
  if (gl2) gl.getExtension('EXT_color_buffer_float');
  else { gl.getExtension('OES_texture_float'); gl.getExtension('WEBGL_color_buffer_float'); }

  const internalFormat = gl2 ? gl.RGBA32F : gl.RGBA;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, gl.RGBA, gl.FLOAT, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    out.error = 'float render target incomplete';
    gl.deleteFramebuffer(fbo); gl.deleteTexture(texture);
    return out;
  }

  const vsSrc = gl2
    ? '#version 300 es\n' + 'in vec2 a_p; void main(){ gl_Position = vec4(a_p,0.0,1.0); }'
    : 'attribute vec2 a_p; void main(){ gl_Position = vec4(a_p,0.0,1.0); }';
  const fsSrc = gl2
    ? '#version 300 es\n' + 'precision highp float; out vec4 o; void main(){ o = vec4(1.0,1.0,1.0,0.5); }'
    : 'precision highp float; void main(){ gl_FragColor = vec4(1.0,1.0,1.0,0.5); }';

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      out.error = 'shader: ' + gl.getShaderInfoLog(sh);
      return null;
    }
    return sh;
  };

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = vs && compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) {
    gl.deleteFramebuffer(fbo); gl.deleteTexture(texture);
    return out;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'a_p');
  gl.linkProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

  gl.viewport(0, 0, 1, 1);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Exactly what splat() sets.
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);

  gl.useProgram(prog);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.BLEND);

  const px = new Float32Array(4);
  try {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
    out.value = px[0];
    // src.a * src.rgb + (1 - src.a) * dst.rgb = 0.5 * 1 + 0.5 * 0 = 0.5
    out.pass = Math.abs(px[0] - 0.5) < 0.05;
    if (!out.pass && px[0] === 0) out.error = 'blend produced zero -- the splat would deposit nothing';
  } catch (e) {
    out.error = 'readPixels: ' + e.message;
  }

  gl.deleteBuffer(buf); gl.deleteProgram(prog);
  gl.deleteShader(vs); gl.deleteShader(fs);
  gl.deleteFramebuffer(fbo); gl.deleteTexture(texture);
  return out;
}

if (typeof window !== 'undefined') {
  window.runTextureSelfTest = runTextureSelfTest;
  window.testTexelFetchImmunity = testTexelFetchImmunity;
  window.textureRoundTrip = textureRoundTrip;
  window.floatBlendRoundTrip = floatBlendRoundTrip;
}
