
function setupDebugCanvas({
    w = 256,
    h = 256,
    corner = 'bottom-right', // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
    parent = document.body,
  } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.className = 'debug-texture-probe';
    Object.assign(c.style, {
      position: 'fixed',
      zIndex: 8,
      imageRendering: 'pixelated',
      border: '1px solid rgba(255,255,255,.3)',
      background: '#111',
    });
    const pos = { 'bottom-right': ['bottom','right'], 'bottom-left': ['bottom','left'],
                  'top-right':['top','right'], 'top-left':['top','left'] }[corner];
    c.style[pos[0]] = '8px'; c.style[pos[1]] = '8px';
    parent.appendChild(c);
    return { canvas: c, ctx2d: c.getContext('2d') };
  }
  

  function makeGLDebugPresenter(gl) {
    // --- Minimal visualize program (same logic as before, condensed) ---
    const vs = `
      attribute vec2 aPos;
      varying vec2 vUV;
      void main(){ vUV = aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }
    `;
    const fs = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D uTex;
      uniform int uMode;
      uniform float uScaleXY, uScaleZ;
      vec3 map(vec3 t){
        float nx = uScaleXY>0.0 ? clamp(t.r/uScaleXY,-1.0,1.0):0.0;
        float ny = uScaleXY>0.0 ? clamp(t.g/uScaleXY,-1.0,1.0):0.0;
        float nz = uScaleZ >0.0 ? clamp(t.b/uScaleZ , -1.0,1.0):0.0;
        return vec3(nx,ny,nz)*0.5+0.5;
      }
      bool bad(float x){ return !(x==x) || abs(x)>1e20; }
      void main(){
        vec4 t = texture2D(uTex, vUV);
        vec3 col;
        if (uMode==0) col = clamp(t.rgb,0.0,1.0);
        else if (uMode==3) col = vec3(bad(t.r)||bad(t.g)||bad(t.b) ? 1.0:0.0);
        else col = map(t.rgb);
        gl_FragColor = vec4(col,1.0);
      }
    `;
    function sh(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const locPos   = gl.getAttribLocation(prog, 'aPos');
    const uTex     = gl.getUniformLocation(prog, 'uTex');
    const uMode    = gl.getUniformLocation(prog, 'uMode');
    const uScaleXY = gl.getUniformLocation(prog, 'uScaleXY');
    const uScaleZ  = gl.getUniformLocation(prog, 'uScaleZ');
  
    // Reusable RGBA8 target + FBO (resized to the debug canvas on demand)
    const targ = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
    function ensureTarget(w,h){
      if (w===targ.w && h===targ.h) return;
      targ.w = w; targ.h = h;
      gl.bindTexture(gl.TEXTURE_2D, targ.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // RGBA8 render target (portable)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targ.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targ.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  
    // Render srcTexture → targ.fbo with visualizer, then readPixels and paint to ctx2d
    function presentTextureToCanvas2D({
      srcTexture,          // WebGLTexture you want to visualize
      debugCanvas,         // HTMLCanvasElement (2D) to paint into
      mode = 1,            // 0=raw, 1=positions, 2=velocity, 3=bad mask
      scaleXY = 1,         // normalize XY for color mapping
      scaleZ  = 1          // normalize Z for color mapping
    }){
      const w = debugCanvas.width, h = debugCanvas.height;
      ensureTarget(w,h);
  
      // draw to offscreen RGBA8
      const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      const prevVP = gl.getParameter(gl.VIEWPORT);
      const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
      const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const prevBlend = gl.isEnabled(gl.BLEND);
  
      gl.bindFramebuffer(gl.FRAMEBUFFER, targ.fbo);
      gl.viewport(0,0,w,h);
      gl.disable(gl.BLEND);
  
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(locPos);
      gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
  
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTexture);
      gl.uniform1i(uTex, 0);
      gl.uniform1i(uMode, mode|0);
      gl.uniform1f(uScaleXY, scaleXY);
      gl.uniform1f(uScaleZ,  scaleZ);
  
      gl.drawArrays(gl.TRIANGLES, 0, 3);
  
      // readback & paint
      const buf = new Uint8ClampedArray(w*h*4);
      gl.readPixels(0,0,w,h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const img = new ImageData(buf, w, h);
      const ctx2d = debugCanvas.getContext('2d');
      // flip Y to match usual screen orientation
      ctx2d.save();
      ctx2d.setTransform(1,0,0,-1, 0,h);
      ctx2d.putImageData(img, 0, 0);
      ctx2d.restore();
  
      // restore
      if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, prevTex0);
      gl.useProgram(prevProg);
      gl.viewport(prevVP[0], prevVP[1], prevVP[2], prevVP[3]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
    }
  
    return { presentTextureToCanvas2D };
  }
