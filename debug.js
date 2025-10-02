// debug-visualizer.js
function makeDebugVisualizer(gl, targetCanvas = gl.canvas) {
    // Fullscreen triangle
    const vs = `
      attribute vec2 aPos;
      varying vec2 vUV;
      void main() {
        vUV = aPos * 0.5 + 0.5;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;
  
    // Modes:
    // 0 = raw RGBA (0..1 range shown directly)
    // 1 = positions heatmap: XY mapped to R/G via brushScale, Z (downwards) mapped to B via bristleLength
    // 2 = velocity heatmap: XY to RG, Z to B using 'scale' as normalization
    // 3 = NaN/Inf mask (white = bad)
    const fs = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D uTex;
      uniform int uMode;
      uniform vec2 uTexSize;
      uniform float uBrushScale;   // world XY scale to normalize colors
      uniform float uBristleLen;   // world Z scale to normalize colors
  
      bool bad(float x) { return !(x==x) || abs(x) > 1e20; }
  
      void main() {
        // Show the *whole* texture: vUV spans [0,1]^2 over the data texture
        vec4 t = texture2D(uTex, vUV);
  
        vec3 col;
        if (uMode == 0) {
          col = clamp(t.rgb, 0.0, 1.0); // just show raw
        } else if (uMode == 1) { // positions -> color
          // Expect positions in world units. Normalize into [-1,1] then to [0,1].
          float nx = uBrushScale > 0.0 ? clamp(t.r / (uBrushScale), -1.0, 1.0) : 0.0;
          float ny = uBrushScale > 0.0 ? clamp(t.g / (uBrushScale), -1.0, 1.0) : 0.0;
          float nz = uBristleLen > 0.0 ? clamp(t.b / (uBristleLen), -1.0, 1.0) : 0.0;
          col = vec3(nx, ny, nz) * 0.5 + 0.5;
        } else if (uMode == 2) { // velocity -> color (same normalization params)
          float nx = uBrushScale > 0.0 ? clamp(t.r / (uBrushScale), -1.0, 1.0) : 0.0;
          float ny = uBrushScale > 0.0 ? clamp(t.g / (uBrushScale), -1.0, 1.0) : 0.0;
          float nz = uBristleLen > 0.0 ? clamp(t.b / (uBristleLen), -1.0, 1.0) : 0.0;
          col = vec3(nx, ny, nz) * 0.5 + 0.5;
        } else { // 3 = bad mask
          col = vec3( bad(t.r) || bad(t.g) || bad(t.b) ? 1.0 : 0.0 );
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `;
  
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPLETE_STATUS ?? gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
      }
      return s;
    }
  
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
    }
  
    // Geometry: fullscreen triangle
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         3, -1,
        -1,  3
      ]),
      gl.STATIC_DRAW
    );
    const locPos = gl.getAttribLocation(prog, 'aPos');
    const uTex = gl.getUniformLocation(prog, 'uTex');
    const uMode = gl.getUniformLocation(prog, 'uMode');
    const uTexSize = gl.getUniformLocation(prog, 'uTexSize');
    const uBrushScale = gl.getUniformLocation(prog, 'uBrushScale');
    const uBristleLen = gl.getUniformLocation(prog, 'uBristleLen');
  
    function draw({ texture, mode=1, texWidth, texHeight, brushScale=1, bristleLength=1 }) {
      // Save state we change
      const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE);
      const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const prevVAEnabled = gl.getVertexAttribState ? gl.getVertexAttribState(locPos) : null;
      const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const prevViewport = gl.getParameter(gl.VIEWPORT);
      const prevBlend = gl.isEnabled(gl.BLEND);
  
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);               // draw to screen
      gl.viewport(0, 0, targetCanvas.width, targetCanvas.height);
      gl.disable(gl.BLEND);
  
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
  
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uTex, 0);
      gl.uniform1i(uMode, mode|0);
      gl.uniform2f(uTexSize, texWidth, texHeight);
      gl.uniform1f(uBrushScale, brushScale);
      gl.uniform1f(uBristleLen, bristleLength);
  
      gl.drawArrays(gl.TRIANGLES, 0, 3);
  
      // Restore minimal state
      if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.activeTexture(prevActiveTex);
      gl.useProgram(prevProg);
      if (prevVAEnabled && prevVAEnabled.enabled === false) gl.disableVertexAttribArray(locPos);
    }
  
    return {
      // Positions as RGB heatmap (R=X, G=Y, B=Z)
      showPositions: (tex, texW, texH, brushScale, bristleLen) =>
        draw({ texture: tex, mode: 1, texWidth: texW, texHeight: texH, brushScale, bristleLength: bristleLen }),
      // Velocity (if you want to peek at velocitiesTexture similarly)
      showVelocities: (tex, texW, texH, scaleXY, scaleZ) =>
        draw({ texture: tex, mode: 2, texWidth: texW, texHeight: texH, brushScale: scaleXY, bristleLength: scaleZ }),
      // Raw RGBA (0..1)
      showRaw: (tex, texW, texH) =>
        draw({ texture: tex, mode: 0, texWidth: texW, texHeight: texH }),
      // NaN/Inf mask
      showBad: (tex, texW, texH) =>
        draw({ texture: tex, mode: 3, texWidth: texW, texHeight: texH }),
    };
  }
  

  function runWebGLSelfTest(existingGL) {
    const results = [];
    const add = (feature, actual, expected, ok, comment) =>
      results.push({ feature, actual, expected, status: ok ? 'OK' : 'NOK', comment });
  
    // Make our own tiny offscreen context unless one is provided
    let gl = existingGL;
    let canvas;
    let createdCtx = false;
    if (!gl) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4;
      gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
        || canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
      createdCtx = true;
    } else {
      canvas = gl.canvas || document.createElement('canvas');
    }
    if (!gl) {
      console.table([{ feature: 'WebGL context', actual: 'null', expected: 'webgl/webgl2', status: 'NOK', comment: 'No WebGL context. Cannot run.' }]);
      return [];
    }
  
    const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const vendorInfo = (() => {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const ven = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const ren = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return `${ven} / ${ren}`;
    })();
  
    add('WebGL version', isGL2 ? 'WebGL2' : 'WebGL1', 'WebGL1 or WebGL2', true, vendorInfo);
  
    // ---------- Helpers ----------
    function makeTex({ internalFormat, format, type, w=4, h=4, filter=gl.NEAREST }) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (isGL2) {
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, format, type, null);
      }
      return t;
    }
    function fboComplete(tex) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      return status === gl.FRAMEBUFFER_COMPLETE;
    }
    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }
    function link(vs, fs) {
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      return p;
    }
    function withViewport(w=1,h=1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0,0,w,h);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    }
  
    // ---------- Basic caps ----------
    const maxVTF = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
    add('MAX_VERTEX_TEXTURE_IMAGE_UNITS', maxVTF, '>= 1', maxVTF >= 1,
        maxVTF >= 1 ? 'Can sample bristle textures in vertex shader.' :
        'VTF=0 → Do NOT sample positions in vertex shader. Use fragment-splat or copy to VBO.');
  
    const varying = gl.getParameter(gl.MAX_VARYING_VECTORS || 0) || (isGL2 ? gl.getParameter(gl.MAX_VARYING_VECTORS) : 'n/a');
    if (varying !== 'n/a') add('MAX_VARYING_VECTORS', varying, '>= 8', varying >= 8, 'Low varyings may require simplifying splat varyings.');
  
    const highpFrag = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const hasFragHighp = !!highpFrag && highpFrag.precision > 0;
    add('Fragment highp float', hasFragHighp, 'true', hasFragHighp,
        hasFragHighp ? 'OK.' : 'No highp in fragment. Keep values small, use mediump, encode positions in [-1,1].');
  
    // ---------- Extensions presence ----------
    const extFloat = isGL2 ? true : !!gl.getExtension('OES_texture_float');
    add('OES_texture_float (or core in GL2)', !!extFloat, 'true', !!extFloat,
        extFloat ? 'Float textures available.' : 'Fallback to HALF_FLOAT textures.');
  
    const extFloatLinear = isGL2 ? true : !!gl.getExtension('OES_texture_float_linear');
    add('OES_texture_float_linear', !!extFloatLinear, 'nice to have', !!extFloatLinear,
        extFloatLinear ? 'Float LINEAR filtering available.' : 'Use NEAREST for simulation textures.');
  
    const extHF = isGL2 ? true : gl.getExtension('OES_texture_half_float');
    add('OES_texture_half_float (or core in GL2)', !!extHF, 'true', !!extHF,
        extHF ? 'Half-float textures available.' : 'If no float either, use RGBA8 packing.');
  
    const extHFLinear = isGL2 ? true : !!gl.getExtension('OES_texture_half_float_linear');
    add('OES_texture_half_float_linear', !!extHFLinear, 'nice to have', !!extHFLinear,
        extHFLinear ? 'Half-float LINEAR filtering available.' : 'Use NEAREST for simulation textures.');
  
    const extCBFloat = isGL2 ? !!gl.getExtension('EXT_color_buffer_float') : !!(gl.getExtension('WEBGL_color_buffer_float') || gl.getExtension('EXT_color_buffer_float'));
    add(isGL2 ? 'EXT_color_buffer_float' : 'WEBGL/EXT_color_buffer_float', !!extCBFloat, 'true (for RGBA32F render targets)', !!extCBFloat,
        extCBFloat ? 'Can render to RGBA32F.' : 'Prefer RGBA16F (half-float) render targets.');
  
    const extCBHalf = isGL2 ? true : !!gl.getExtension('EXT_color_buffer_half_float');
    add('EXT_color_buffer_half_float', !!extCBHalf, 'true (for RGBA16F render targets)', !!extCBHalf,
        extCBHalf ? 'Can render to RGBA16F.' : 'If also no CB float → cannot render to float; use RGBA8 packing.');
  
    // ---------- Practical: renderability tests ----------
    // FLOAT renderable?
    let floatRenderable = false;
    try {
      if (isGL2) {
        const tex = makeTex({ internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, w: 4, h: 4 });
        floatRenderable = fboComplete(tex);
        gl.deleteTexture(tex);
      } else if (extFloat) {
        const tex = makeTex({ format: gl.RGBA, type: gl.FLOAT, w: 4, h: 4 });
        floatRenderable = fboComplete(tex);
        gl.deleteTexture(tex);
      }
    } catch(e) { floatRenderable = false; }
    add('FBO renderable: RGBA32F', floatRenderable, 'true (or skip if using 16F)', floatRenderable,
        floatRenderable ? 'OK to use RGBA32F for physics.' : 'Use RGBA16F (half-float) or RGBA8 packing.');
  
    // HALF_FLOAT renderable?
    let halfRenderable = false;
    try {
      if (isGL2) {
        const tex = makeTex({ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, w: 4, h: 4 });
        halfRenderable = fboComplete(tex);
        gl.deleteTexture(tex);
      } else if (extHF && extCBHalf) {
        const ttype = extHF.HALF_FLOAT_OES;
        const tex = makeTex({ format: gl.RGBA, type: ttype, w: 4, h: 4 });
        halfRenderable = fboComplete(tex);
        gl.deleteTexture(tex);
      }
    } catch(e) { halfRenderable = false; }
    add('FBO renderable: RGBA16F', halfRenderable, 'true (fallback)', halfRenderable,
        halfRenderable ? 'Good fallback render target.' : 'If no 32F either → use RGBA8 packing.');
  
    // ---------- Practical: vertex texture fetch test ----------
    // Draw a full-screen quad where the *vertex shader* samples a texture to set a varying color.
    // If VTF is unsupported, color will read as ~black regardless of the texture content.
    function testVertexTextureFetch() {
      withViewport(2,2);
  
      // Build a small RGBA8 texture with a distinct color
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const pix = new Uint8Array([64, 128, 192, 255]); // (0.25, 0.5, 0.75, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pix);
  
      const vsSrc = `
        attribute vec2 a;
        uniform sampler2D u;
        varying vec4 v;
        void main(){
          // VTF: sample in vertex shader
          v = texture2D(u, vec2(0.5,0.5));
          gl_Position = vec4(a, 0.0, 1.0);
        }`;
      const fsSrc = `precision mediump float; varying vec4 v; void main(){ gl_FragColor = v; }`;
  
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      const prog = link(vs, fs);
      const okLink = gl.getProgramParameter(prog, gl.LINK_STATUS);
  
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  
      gl.useProgram(prog);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, 'u'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  
      const out = new Uint8Array(4);
      gl.readPixels(0,0,1,1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  
      // Clean up
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
      gl.deleteBuffer(buf); gl.deleteTexture(tex);
  
      // Expect close to [64,128,192,255] if VTF works
      const pass = out[0] >= 40 && out[1] >= 100 && out[2] >= 150;
      return { pass, out: Array.from(out), okLink };
    }
  
    const vtfTest = testVertexTextureFetch();
    add('Vertex texture fetch (measured)', vtfTest.out.join(','), 'samples tex in VS → color ≈ 64,128,192', vtfTest.pass,
        vtfTest.pass ? 'VTF works in practice.' : 'VTF FAILED → render bristles without vertex sampling (fragment-splat or VBO).');
  
    // ---------- Practical: float-linear sampling test (harmless; we prefer NEAREST anyway) ----------
    function testFloatLinearSampling() {
      try {
        if (!isGL2 && !gl.getExtension('OES_texture_float')) return { supported: false, pass: false, out: [0,0,0,0] };
  
        withViewport(2,2);
  
        // 2x1 float texture: left=red=1, right=red=0; sample at 25% with LINEAR → expect ~0.75
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
        const data = new Float32Array([
          1,0,0,1,   0,0,0,1
        ]);
        if (isGL2) {
          // In GL2 we can use RGBA32F texture with float sampler
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F || gl.RGBA, 2, 1, 0, gl.RGBA, gl.FLOAT, data);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 1, 0, gl.RGBA, gl.FLOAT, data);
        }
  
        const vsSrc = `attribute vec2 a; varying vec2 v; void main(){ v = a*0.5+0.5; gl_Position = vec4(a,0.0,1.0); }`;
        const fsSrc = `
          precision highp float;
          varying vec2 v; uniform sampler2D u;
          void main(){ gl_FragColor = texture2D(u, vec2(0.25, 0.5)); }`;
        const vs = compile(gl.VERTEX_SHADER, vsSrc);
        const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        const prog = link(vs, fs);
  
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        gl.useProgram(prog);
        const loc = gl.getAttribLocation(prog, 'a');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'u'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  
        const out = new Uint8Array(4);
        gl.readPixels(0,0,1,1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  
        gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
        gl.deleteBuffer(buf); gl.deleteTexture(tex);
  
        const pass = out[0] > 150; // ~0.75 * 255 ≈ 191
        return { supported: true, pass, out: Array.from(out) };
      } catch(e) {
        return { supported: false, pass: false, out: [0,0,0,0] };
      }
    }
  
    const fls = testFloatLinearSampling();
    add('Float texture LINEAR sampling (measured)', fls.supported ? fls.out.join(',') : 'unsupported', 'nice to have (we can use NEAREST)', fls.pass,
        fls.pass ? 'Float LINEAR behaves.' : 'Use NEAREST for all simulation textures.');
  
    console.groupCollapsed('%cWebGL Self-Test Results', 'font-weight:bold');
    console.table(results);
    console.groupEnd();
    return results;
  }
  