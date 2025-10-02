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
            -1, 3
        ]),
        gl.STATIC_DRAW
    );
    const locPos = gl.getAttribLocation(prog, 'aPos');
    const uTex = gl.getUniformLocation(prog, 'uTex');
    const uMode = gl.getUniformLocation(prog, 'uMode');
    const uTexSize = gl.getUniformLocation(prog, 'uTexSize');
    const uBrushScale = gl.getUniformLocation(prog, 'uBrushScale');
    const uBristleLen = gl.getUniformLocation(prog, 'uBristleLen');

    function draw({ texture, mode = 1, texWidth, texHeight, brushScale = 1, bristleLength = 1 }) {
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
        gl.uniform1i(uMode, mode | 0);
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
    function makeTex({ internalFormat, format, type, w = 4, h = 4, filter = gl.NEAREST }) {
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
    function withViewport(w = 1, h = 1) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
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
    } catch (e) { floatRenderable = false; }
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
    } catch (e) { halfRenderable = false; }
    add('FBO renderable: RGBA16F', halfRenderable, 'true (fallback)', halfRenderable,
        halfRenderable ? 'Good fallback render target.' : 'If no 32F either → use RGBA8 packing.');

    // ---------- Practical: vertex texture fetch test ----------
    // Draw a full-screen quad where the *vertex shader* samples a texture to set a varying color.
    // If VTF is unsupported, color will read as ~black regardless of the texture content.
    function testVertexTextureFetch() {
        withViewport(2, 2);

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
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.useProgram(prog);
        const loc = gl.getAttribLocation(prog, 'a');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'u'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const out = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);

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
            if (!isGL2 && !gl.getExtension('OES_texture_float')) return { supported: false, pass: false, out: [0, 0, 0, 0] };

            withViewport(2, 2);

            // 2x1 float texture: left=red=1, right=red=0; sample at 25% with LINEAR → expect ~0.75
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            const data = new Float32Array([
                1, 0, 0, 1, 0, 0, 0, 1
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
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            gl.useProgram(prog);
            const loc = gl.getAttribLocation(prog, 'a');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(gl.getUniformLocation(prog, 'u'), 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            const out = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);

            gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
            gl.deleteBuffer(buf); gl.deleteTexture(tex);

            const pass = out[0] > 150; // ~0.75 * 255 ≈ 191
            return { supported: true, pass, out: Array.from(out) };
        } catch (e) {
            return { supported: false, pass: false, out: [0, 0, 0, 0] };
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



async function runWebGLUsageSelfTest(opts) {
    const canvas = opts.canvas;
    const gl = opts.gl || canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    const getPaintingRect = opts.getPaintingRect || (() => ({ left: 0, bottom: 0, width: canvas.width, height: canvas.height }));
    const results = [];
    const add = (feature, actual, expected, ok, comment) => results.push({ feature, actual, expected, status: ok ? 'OK' : 'NOK', comment });

    // ---------- A) Canvas sizing (CSS vs drawing buffer) ----------
    function testCanvasSizing() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const cssW = Math.round(rect.width * dpr);
        const cssH = Math.round(rect.height * dpr);
        const ok = (canvas.width === cssW) && (canvas.height === cssH);
        add('Canvas drawing-buffer size', `${canvas.width}x${canvas.height}`, `${cssW}x${cssH} (CSS*DPR)`, ok,
            ok ? 'Drawing buffer matches CSS size × DPR.' : 'Resize canvas to CSS*DPR and reset viewport.');
    }

    // ---------- B) Painting rectangle placement (bottom-origin) ----------
    function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    function link(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); return p; }

    function testPaintingRectPlacement() {
        const rect = getPaintingRect();

        // Draw an outline of the painting rect to the screen and probe pixels at 4 corners.
        const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
        const prevVP = gl.getParameter(gl.VIEWPORT);
        const prevBlend = gl.isEnabled(gl.BLEND);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);

        const vsSrc = `
      attribute vec2 a;
      uniform vec2 uCanvas;
      void main(){
        vec2 ndc = vec2(-1.0 + 2.0*a.x/uCanvas.x, -1.0 + 2.0*a.y/uCanvas.y);
        gl_Position = vec4(ndc, 0.0, 1.0);
      }`;
        const fsSrc = `precision mediump float; void main(){ gl_FragColor = vec4(1.0,0.0,0.0,1.0);} `;
        const v = compile(gl.VERTEX_SHADER, vsSrc), f = compile(gl.FRAGMENT_SHADER, fsSrc), p = link(v, f);
        gl.useProgram(p);
        const locA = gl.getAttribLocation(p, 'a');
        const locC = gl.getUniformLocation(p, 'uCanvas');

        const x0 = rect.left, y0 = rect.bottom;
        const x1 = rect.left + rect.width, y1 = rect.bottom + rect.height;
        const line = new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, line, gl.STREAM_DRAW);
        gl.uniform2f(locC, canvas.width, canvas.height);
        gl.enableVertexAttribArray(locA);
        gl.vertexAttribPointer(locA, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINE_STRIP, 0, 5);

        // Probe: read 1 pixel at each expected corner; expect "red" (outline)
        function readPixel(x, y) {
            const px = new Uint8Array(4);
            gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            return Array.from(px);
        }
        const tl = readPixel(x0, y1 - 1); // top-left of rect (using bottom-origin coords)
        const tr = readPixel(x1 - 1, y1 - 1);
        const br = readPixel(x1 - 1, y0);
        const bl = readPixel(x0, y0);
        const isRed = (px) => px[0] > 128 && px[1] < 32 && px[2] < 32; // crude "red enough"
        const okTL = isRed(tl), okTR = isRed(tr), okBR = isRed(br), okBL = isRed(bl);
        const ok = okTL && okTR && okBR && okBL;

        add('Painting rect uniforms (bottom-origin expected)',
            `TL:${tl} TR:${tr} BR:${br} BL:${bl}`,
            'Red outline at 4 corners',
            ok,
            ok ? 'u_paintingPosition/u_paintingDimensions look bottom-origin and correct.'
                : 'Rect outline not where expected → likely top-origin or wrong units sent to shader.');

        // cleanup
        gl.deleteBuffer(buf); gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f);
        if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        gl.viewport(prevVP[0], prevVP[1], prevVP[2], prevVP[3]);
        gl.useProgram(prevProg);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
    }

    // ---------- C) Viewport & scissor safety for offscreen ----------
    function testOffscreenViewportScissor() {
        const prevScissorEnabled = gl.isEnabled(gl.SCISSOR_TEST);
        const prevScissorBox = gl.getParameter(gl.SCISSOR_BOX);
        const prevViewport = gl.getParameter(gl.VIEWPORT);

        // Build a small FBO and write full-frame; if scissor/viewport are stale, we’ll detect it.
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const W = 32, H = 32;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        // Intentionally DO NOT touch scissor/viewport now; first clear:
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);

        // Now do the "correct" thing: explicitly reset viewport & scissor off.
        gl.viewport(0, 0, W, H);
        gl.disable(gl.SCISSOR_TEST);

        // Draw a fullscreen color (write white)
        const vs = compile(gl.VERTEX_SHADER, `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.);} `);
        const fs = compile(gl.FRAGMENT_SHADER, `precision mediump float; void main(){ gl_FragColor=vec4(1.,1.,1.,1.);} `);
        const prog = link(vs, fs);
        gl.useProgram(prog);
        const qb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, qb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STREAM_DRAW);
        const la = gl.getAttribLocation(prog, 'a');
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Read a 4x4 grid to ensure we wrote beyond lower-left
        const pixels = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let whiteCount = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) whiteCount++;
        const okFull = (whiteCount === W * H);

        add('Offscreen pass writes full target with explicit viewport/scissor',
            `white px=${whiteCount}/${W * H}`,
            `${W * H} white pixels`,
            okFull,
            okFull ? 'Writes reach full RT when viewport/scissor set explicitly.'
                : 'Full-target draw didn’t reach all pixels → stale state or driver quirk.');

        // Also report current global state (this is informative; your passes should *reset* these each time)
        add('GL state: SCISSOR_TEST enabled?', prevScissorEnabled, 'false between passes', !prevScissorEnabled,
            prevScissorEnabled ? `SCISSOR_TEST was ON with box ${prevScissorBox}. Reset it per pass.` : 'Good: scissor off.');
        add('GL state: VIEWPORT', prevViewport.join(','), 'set per target (FBO vs screen)', true,
            'Always set viewport to target size at start of each pass.');

        // cleanup
        gl.deleteBuffer(qb); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    }

    // ---------- D) Randoms sampling: edge vs center ----------
    function testRandomsTexelCenters() {
        // Build 4x4 RGBA8 "randoms" with a sharp step at the last column
        const rw = 4, rh = 4;
        const data = new Uint8Array(rw * rh * 4);
        for (let y = 0; y < rh; y++) {
            for (let x = 0; x < rw; x++) {
                const i = (y * rw + x) * 4;
                const step = (x === rw - 1) ? 255 : 0; // last column bright
                data[i + 0] = x * 32; data[i + 1] = y * 32; data[i + 2] = step; data[i + 3] = 255;
            }
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);

        // Render two 2x1 pixels: left = edge sample, right = center sample.
        const vs = compile(gl.VERTEX_SHADER, `
      attribute vec2 a; varying vec2 v; void main(){ v=a*0.5+0.5; gl_Position=vec4(a,0.,1.); }`);
        const fs = compile(gl.FRAGMENT_SHADER, `
      precision highp float; varying vec2 v; uniform sampler2D u; uniform vec2 uRes;
      void main(){
        // map v.x<0.5 → edge path; v.x>=0.5 → center path, sampling last column row 0
        vec2 px = vec2(float(${rw - 1}), 0.0);
        vec2 uvEdge   = (px) / uRes;           // edge of texel
        vec2 uvCenter = (px + vec2(0.5)) / uRes; // center of texel
        vec4 cEdge = texture2D(u, uvEdge);
        vec4 cCenter = texture2D(u, uvCenter);
        gl_FragColor = (v.x < 0.5) ? cEdge : cCenter;
      }`);
        const prog = link(vs, fs);
        gl.useProgram(prog);
        const locA = gl.getAttribLocation(prog, 'a');
        const locU = gl.getUniformLocation(prog, 'u');
        const locR = gl.getUniformLocation(prog, 'uRes');
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STREAM_DRAW);
        gl.enableVertexAttribArray(locA);
        gl.vertexAttribPointer(locA, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(locU, 0);
        gl.uniform2f(locR, rw, rh);

        const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, 2, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const left = new Uint8Array(4), right = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, left);
        gl.readPixels(1, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, right);

        const edgeBlue = left[2], centerBlue = right[2];
        const ok = centerBlue > edgeBlue; // center should pick 255, edge often <255 due to edge clamp/interp
        add('Randoms sampling (edge vs center +0.5)',
            `edgeB=${edgeBlue}, centerB=${centerBlue}`,
            'centerB > edgeB',
            ok,
            ok ? 'Sampling at texel centers (+0.5) avoids edge bias.' : 'Edge and center similar → still use +0.5; it’s safest across GPUs.');

        // cleanup
        gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
        gl.deleteTexture(tex);
    }

    // ---------- E) Pointer mapping via user taps ----------
    async function testPointerMapping() {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();

        const taps = [];
        console.log('%cPointer test: tap TL, TR, BR, BL corners (on the canvas).', 'color: #0a0');

        const promise = new Promise(resolve => {
            let step = 0;
            const want = ['TL', 'TR', 'BR', 'BL'];
            function handler(ev) {
                const t = ev.touches?.[0] || ev.changedTouches?.[0] || ev;
                const clientX = t.clientX, clientY = t.clientY;

                // Correct bottom-origin mapping
                const xCorrect = (clientX - rect.left) * (canvas.width / rect.width);
                const yTop = (clientY - rect.top) * (canvas.height / rect.height);
                const yCorrect = canvas.height - yTop;

                // Common top-origin mistake
                const yWrong = yTop;

                const expected = want[step];
                taps.push({ step: expected, clientX, clientY, xCorrect, yCorrect, yWrong });
                step++;
                if (step >= 4) {
                    canvas.removeEventListener('pointerdown', handler);
                    canvas.removeEventListener('touchstart', handler);
                    resolve();
                } else {
                    console.log(`Tap ${want[step]} …`);
                }
                ev.preventDefault();
            }
            console.log('Tap TL …');
            canvas.addEventListener('pointerdown', handler, { passive: false });
            // canvas.addEventListener('touchstart', handler, { passive: false });
        });
        await promise;

        // Evaluate which mapping better matches corners
        function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

        const corners = {
            TL: { x: 0, y: canvas.height - 1 },
            TR: { x: canvas.width - 1, y: canvas.height - 1 },
            BR: { x: canvas.width - 1, y: 0 },
            BL: { x: 0, y: 0 }
        };

        let errCorrect = 0, errWrong = 0;
        for (const tap of taps) {
            const target = corners[tap.step];
            errCorrect += dist(tap.xCorrect, tap.yCorrect, target.x, target.y);
            errWrong += dist(tap.xCorrect, tap.yWrong, target.x, target.y);
        }
        const ok = errCorrect < errWrong;
        add('Pointer → canvas mapping (bottom-origin vs top-origin)',
            `err(bottom-origin)=${errCorrect.toFixed(1)} px; err(top-origin)=${errWrong.toFixed(1)} px`,
            'bottom-origin error < top-origin error',
            ok,
            ok ? 'Use bottom-origin mapping for y.' : 'Your inputs look top-origin; invert y: y = canvas.height - yTop.');
    }

    // ---------- Run all ----------
    testCanvasSizing();
    testPaintingRectPlacement();
    testOffscreenViewportScissor();
    testRandomsTexelCenters();
    await testPointerMapping();

    console.groupCollapsed('%cWebGL Usage Self-Test', 'font-weight:bold;color:#06c');
    console.table(results);
    console.groupEnd();
    return results;
}


function resizeCanvasToCSS(canvas, gl) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.floor(canvas.clientWidth  || canvas.width  || 300));
    const cssH = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 150));
    const newW = Math.floor(cssW * dpr);
    const newH = Math.floor(cssH * dpr);
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width  = newW;
      canvas.height = newH;
      // Screen (default framebuffer) viewport must match the new drawing buffer size.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, newW, newH);
    }
  }
  

  