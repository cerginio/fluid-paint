// ES6 class version of WrappedGL

// --- helpers ---
function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
    return true;
  }
  
  function keysInObject(obj) {
    let count = 0;
    for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) count += 1;
    return count;
  }
  
  class WrappedProgram {
    constructor(wgl, vertexShaderSource, fragmentShaderSource, requestedAttributeLocations) {
      this.uniformLocations = {};
      this.uniforms = {};
  
      const gl = wgl.gl;
  
      const buildShader = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          console.log(gl.getShaderInfoLog(shader));
        }
        return shader;
      };
  
      const vertexShader = buildShader(gl.VERTEX_SHADER, vertexShaderSource);
      const fragmentShader = buildShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  
      const program = (this.program = gl.createProgram());
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
  
      if (requestedAttributeLocations !== undefined) {
        for (const attributeName in requestedAttributeLocations) {
          gl.bindAttribLocation(program, requestedAttributeLocations[attributeName], attributeName);
        }
      }
      gl.linkProgram(program);
  
      // Attribute locations
      this.attributeLocations = {};
      const numberOfAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
      for (let i = 0; i < numberOfAttributes; ++i) {
        const activeAttrib = gl.getActiveAttrib(program, i);
        const attributeName = activeAttrib.name;
        this.attributeLocations[attributeName] = gl.getAttribLocation(program, attributeName);
      }
  
      // Uniform locations
      const uniformLocations = (this.uniformLocations = {});
      const numberOfUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < numberOfUniforms; i += 1) {
        const activeUniform = gl.getActiveUniform(program, i);
        const uniformLocation = gl.getUniformLocation(program, activeUniform.name);
        uniformLocations[activeUniform.name] = uniformLocation;
      }
    }
  
    // convenience
    getAttribLocation(name) {
      return this.attributeLocations[name];
    }
  }
  
  class State {
    constructor(wgl) {
      this.wgl = wgl;
      this.changedParameters = {};
    }
  
    setParameter(parameterName, values) {
      if (!arraysEqual(values, this.wgl.parameters[parameterName].defaults)) {
        this.changedParameters[parameterName] = values;
      } else if (this.changedParameters.hasOwnProperty(parameterName)) {
        delete this.changedParameters[parameterName];
      }
    }
  
    clone() {
      const newState = new this.constructor(this.wgl);
      for (const parameterName in this.changedParameters) {
        if (this.changedParameters.hasOwnProperty(parameterName)) {
          const parameterValues = this.changedParameters[parameterName];
          const clonedValues = [];
          for (let i = 0; i < parameterValues.length; ++i) clonedValues.push(parameterValues[i]);
          newState.changedParameters[parameterName] = clonedValues;
        }
      }
      return newState;
    }
  }
  
  class DrawState extends State {
    constructor(wgl) {
      super(wgl);
      this.uniforms = {};
    }
  
    bindFramebuffer(framebuffer) { this.setParameter('framebuffer', [framebuffer]); return this; }
    viewport(x, y, width, height) { this.setParameter('viewport', [x, y, width, height]); return this; }
    enable(cap) {
      if (cap === this.wgl.DEPTH_TEST) this.setParameter('depthTest', [true]);
      else if (cap === this.wgl.BLEND) this.setParameter('blend', [true]);
      else if (cap === this.wgl.CULL_FACE) this.setParameter('cullFace', [true]);
      else if (cap === this.wgl.POLYGON_OFFSET_FILL) this.setParameter('polygonOffsetFill', [true]);
      else if (cap === this.wgl.SCISSOR_TEST) this.setParameter('scissorTest', [true]);
      return this;
    }
    disable(cap) {
      if (cap === this.wgl.DEPTH_TEST) this.setParameter('depthTest', [false]);
      else if (cap === this.wgl.BLEND) this.setParameter('blend', [false]);
      else if (cap === this.wgl.CULL_FACE) this.setParameter('cullFace', [false]);
      else if (cap === this.wgl.POLYGON_OFFSET_FILL) this.setParameter('polygonOffsetFill', [false]);
      else if (cap === this.wgl.SCISSOR_TEST) this.setParameter('scissorTest', [false]);
      return this;
    }
    vertexAttribPointer(buffer, index, size, type, normalized, stride, offset) {
      this.setParameter('attributeArray' + index.toString(), [buffer, size, type, normalized, stride, offset]);
      if (this.instancedExt && this.changedParameters.hasOwnProperty('attributeDivisor' + index.toString())) {
        this.setParameter('attributeDivisor' + index.toString(), [0]);
      }
      return this;
    }
    bindIndexBuffer(buffer) { this.setParameter('indexBuffer', [buffer]); return this; }
    depthFunc(func) { this.setParameter('depthFunc', [func]); return this; }
    frontFace(mode) { this.setParameter('frontFace', [mode]); return this; }
    blendEquation(mode) { this.blendEquationSeparate(mode, mode); return this; }
    blendEquationSeparate(modeRGB, modeAlpha) { this.setParameter('blendEquation', [modeRGB, modeAlpha]); return this; }
    blendFunc(sFactor, dFactor) { this.blendFuncSeparate(sFactor, dFactor, sFactor, dFactor); return this; }
    blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha) { this.setParameter('blendFunc', [srcRGB, dstRGB, srcAlpha, dstAlpha]); return this; }
    scissor(x, y, width, height) { this.setParameter('scissor', [x, y, width, height]); return this; }
    useProgram(program) { this.setParameter('program', [program]); return this; }
    bindTexture(unit, target, texture) { this.setParameter('texture' + unit.toString(), [target, texture]); return this; }
    colorMask(r, g, b, a) { this.setParameter('colorMask', [r, g, b, a]); return this; }
    depthMask(enabled) { this.setParameter('depthMask', [enabled]); return this; }
    polygonOffset(factor, units) { this.setParameter('polygonOffset', [factor, units]); return this; }
  
    uniformTexture(uniformName, unit, target, texture) {
      this.uniform1i(uniformName, unit);
      this.bindTexture(unit, target, texture);
      return this;
    }
    uniform1i(uniformName, value) { this.uniforms[uniformName] = { type: '1i', value: [value] }; return this; }
    uniform2i(uniformName, x, y) { this.uniforms[uniformName] = { type: '2i', value: [x, y] }; return this; }
    uniform3i(uniformName, x, y, z) { this.uniforms[uniformName] = { type: '3i', value: [x, y, z] }; return this; }
    uniform4i(uniformName, x, y, z, w) { this.uniforms[uniformName] = { type: '4i', value: [x, y, z, w] }; return this; }
    uniform1f(uniformName, value) { this.uniforms[uniformName] = { type: '1f', value: value }; return this; }
    uniform2f(uniformName, x, y) { this.uniforms[uniformName] = { type: '2f', value: [x, y] }; return this; }
    uniform3f(uniformName, x, y, z) { this.uniforms[uniformName] = { type: '3f', value: [x, y, z] }; return this; }
    uniform4f(uniformName, x, y, z, w) { this.uniforms[uniformName] = { type: '4f', value: [x, y, z, w] }; return this; }
    uniform1fv(uniformName, value) { this.uniforms[uniformName] = { type: '1fv', value: [value] }; return this; }
    uniform2fv(uniformName, value) { this.uniforms[uniformName] = { type: '2fv', value: [value] }; return this; }
    uniform3fv(uniformName, value) { this.uniforms[uniformName] = { type: '3fv', value: [value] }; return this; }
    uniform4fv(uniformName, value) { this.uniforms[uniformName] = { type: '4fv', value: [value] }; return this; }
    uniformMatrix2fv(uniformName, transpose, matrix) { this.uniforms[uniformName] = { type: 'matrix2fv', value: [transpose, matrix] }; return this; }
    uniformMatrix3fv(uniformName, transpose, matrix) { this.uniforms[uniformName] = { type: 'matrix3fv', value: [transpose, matrix] }; return this; }
    uniformMatrix4fv(uniformName, transpose, matrix) { this.uniforms[uniformName] = { type: 'matrix4fv', value: [transpose, matrix] }; return this; }
  }
  
  class ClearState extends State {
    bindFramebuffer(framebuffer) { this.setParameter('framebuffer', [framebuffer]); return this; }
    clearColor(r, g, b, a) { this.setParameter('clearColor', [r, g, b, a]); return this; }
    clearDepth(depth) { this.setParameter('clearDepth', [depth]); return this; }
    colorMask(r, g, b, a) { this.setParameter('colorMask', [r, g, b, a]); return this; }
    depthMask(enabled) { this.setParameter('depthMask', [enabled]); return this; }
    enable(cap) { if (cap === this.wgl.SCISSOR_TEST) this.setParameter('scissorTest', [true]); return this; }
    disable(cap) { if (cap === this.wgl.SCISSOR_TEST) this.setParameter('scissorTest', [false]); return this; }
    scissor(x, y, width, height) { this.setParameter('scissor', [x, y, width, height]); return this; }
  }
  
  class ReadState extends State {
    bindFramebuffer(framebuffer) { this.setParameter('framebuffer', [framebuffer]); return this; }
  }
  
  class WrappedGL {
    // --- static factory ---
    static create(canvas, options) {
      let gl = null;
      try {
        gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      } catch (_) {
        return null; // no webgl support
      }
      if (gl === null) return null;
      return new WrappedGL(gl);
    }
  
    constructor(gl) {
      this.gl = gl;
  
      // copy numeric constants from the WebGLRenderingContext onto this (replaces CONSTANT_NAMES loop)
      for (const k in gl) {
        if (typeof gl[k] === 'number') this[k] = gl[k];
      }
  
      this.changedParameters = {};
      this.parameters = {
        framebuffer: {
          defaults: [null],
          setter: (framebuffer) => { gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); },
          usedInDraw: true, usedInClear: true, usedInRead: true
        },
        program: {
          defaults: [{ program: null }],
          setter: (wrappedProgram) => { gl.useProgram(wrappedProgram.program); },
          usedInDraw: true
        },
        viewport: { defaults: [0, 0, 0, 0], setter: gl.viewport.bind(gl), usedInDraw: true, usedInClear: true },
        indexBuffer: {
          defaults: [null],
          setter: (buffer) => { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); },
          usedInDraw: true
        },
        depthTest: {
          defaults: [false],
          setter: (enabled) => enabled ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST),
          usedInDraw: true
        },
        depthFunc: { defaults: [gl.LESS], setter: gl.depthFunc.bind(gl), usedInDraw: true },
        cullFace: {
          defaults: [false],
          setter: (enabled) => enabled ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE),
          usedInDraw: true
        },
        frontFace: { defaults: [gl.CCW], setter: gl.frontFace.bind(gl) },
        blend: {
          defaults: [false],
          setter: (enabled) => enabled ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND),
          usedInDraw: true
        },
        blendEquation: { defaults: [gl.FUNC_ADD, gl.FUNC_ADD], setter: gl.blendEquationSeparate.bind(gl), usedInDraw: true },
        blendFunc: { defaults: [gl.ONE, gl.ZERO, gl.ONE, gl.ZERO], setter: gl.blendFuncSeparate.bind(gl), usedInDraw: true },
        polygonOffsetFill: {
          defaults: [false],
          setter: (enabled) => enabled ? gl.enable(gl.POLYGON_OFFSET_FILL) : gl.disable(gl.POLYGON_OFFSET_FILL),
          usedInDraw: true
        },
        polygonOffset: { defaults: [0, 0], setter: gl.polygonOffset.bind(gl), usedInDraw: true },
        scissorTest: {
          defaults: [false],
          setter: (enabled) => enabled ? gl.enable(gl.SCISSOR_TEST) : gl.disable(gl.SCISSOR_TEST),
          usedInDraw: true, usedInClear: true
        },
        scissor: { defaults: [0, 0, 0, 0], setter: gl.scissor.bind(gl), usedInDraw: true, usedInClear: true },
        colorMask: { defaults: [true, true, true, true], setter: gl.colorMask.bind(gl), usedInDraw: true, usedInClear: true },
        depthMask: { defaults: [true], setter: gl.depthMask.bind(gl), usedInDraw: true, usedInClear: true },
        clearColor: { defaults: [0, 0, 0, 0], setter: gl.clearColor.bind(gl), usedInClear: true },
        clearDepth: { defaults: [1], setter: gl.clearDepth.bind(gl), usedInClear: true },
      };
  
      // dynamic attribute array parameters
      const maxVertexAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
      for (let i = 0; i < maxVertexAttributes; ++i) {
        this.parameters['attributeArray' + i.toString()] = {
          defaults: [null, 0, null, false, 0, 0],
          setter: (() => {
            const index = i;
            return (buffer, size, type, normalized, stride, offset) => {
              if (buffer !== null) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
                gl.enableVertexAttribArray(index);
              }
            };
          })(),
          usedInDraw: true,
        };
      }
  
      // texture unit bindings
      const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
      for (let i = 0; i < maxTextures; ++i) {
        this.parameters['texture' + i.toString()] = {
          defaults: [gl.TEXTURE_2D, null],
          setter: (() => {
            const unit = i;
            return (target, texture) => {
              gl.activeTexture(gl.TEXTURE0 + unit);
              gl.bindTexture(target, texture);
            };
          })(),
          usedInDraw: true,
        };
      }
  
      this.uniformSetters = {
        '1i': gl.uniform1i.bind(gl),
        '2i': gl.uniform2i.bind(gl),
        '3i': gl.uniform3i.bind(gl),
        '4i': gl.uniform4i.bind(gl),
        '1f': gl.uniform1f.bind(gl),
        '2f': gl.uniform2f.bind(gl),
        '3f': gl.uniform3f.bind(gl),
        '4f': gl.uniform4f.bind(gl),
        '1fv': gl.uniform1fv.bind(gl),
        '2fv': gl.uniform2fv.bind(gl),
        '3fv': gl.uniform3fv.bind(gl),
        '4fv': gl.uniform4fv.bind(gl),
        'matrix2fv': gl.uniformMatrix2fv.bind(gl),
        'matrix3fv': gl.uniformMatrix3fv.bind(gl),
        'matrix4fv': gl.uniformMatrix4fv.bind(gl),
      };
  
      this.defaultTextureUnit = 0;
    }
  
    // --- static feature checks ---
    static checkWebGLSupport(successCallback, failureCallback) {
      WrappedGL.checkWebGLSupportWithExtensions([], successCallback, () => { failureCallback(); });
    }
  
    static checkWebGLSupportWithExtensions(extensions, successCallback, failureCallback) {
      const canvas = document.createElement('canvas');
      let gl = null;
      try {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      } catch (_) {
        failureCallback(false, []);
        return;
      }
      if (gl === null) {
        failureCallback(false, []);
        return;
      }
  
      const unsupportedExtensions = [];
      for (let i = 0; i < extensions.length; ++i) {
        if (gl.getExtension(extensions[i]) === null) unsupportedExtensions.push(extensions[i]);
      }
      if (unsupportedExtensions.length > 0) {
        failureCallback(true, unsupportedExtensions);
        return;
      }
      successCallback();
    }
  
    // --- extensions / parameters ---
    getSupportedExtensions() { return this.gl.getSupportedExtensions(); }
  
    // returns null if not supported, otherwise extension object (and patches state for instancing)
    getExtension(name) {
      const gl = this.gl;
  
      if (name === 'ANGLE_instanced_arrays') {
        const instancedExt = gl.getExtension('ANGLE_instanced_arrays');
        if (instancedExt === null) return null;
  
        this.instancedExt = instancedExt;
  
        const maxVertexAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        for (let i = 0; i < maxVertexAttributes; ++i) {
          this.parameters['attributeDivisor' + i.toString()] = {
            defaults: [0],
            setter: (() => {
              const index = i;
              return (divisor) => { instancedExt.vertexAttribDivisorANGLE(index, divisor); };
            })(),
            usedInDraw: true,
          };
        }
  
        // patch DrawState methods to cooperate with divisors
        const origVAP = DrawState.prototype.vertexAttribPointer;
        DrawState.prototype.vertexAttribPointer = function (buffer, index, size, type, normalized, stride, offset) {
          const ret = origVAP.call(this, buffer, index, size, type, normalized, stride, offset);
          if (this.changedParameters.hasOwnProperty('attributeDivisor' + index.toString())) {
            this.setParameter('attributeDivisor' + index.toString(), [0]);
          }
          return ret;
        };
        DrawState.prototype.vertexAttribDivisorANGLE = function (index, divisor) {
          this.setParameter('attributeDivisor' + index.toString(), [divisor]);
          return this;
        };
  
        // instanced draw wrappers
        this.drawArraysInstancedANGLE = (drawState, mode, first, count, primcount) => {
          this.resolveDrawState(drawState);
          this.instancedExt.drawArraysInstancedANGLE(mode, first, count, primcount);
        };
        this.drawElementsInstancedANGLE = (drawState, mode, count, type, indices, primcount) => {
          this.resolveDrawState(drawState);
          this.instancedExt.drawElementsInstancedANGLE(mode, count, type, indices, primcount);
        };
  
        return {};
      }
  
      return gl.getExtension(name);
    }
  
    getParameter(parameter) { return this.gl.getParameter(parameter); }
  
    canRenderToTexture(type) {
      const gl = this.gl;
      const framebuffer = this.createFramebuffer();
      const texture = this.buildTexture(gl.RGBA, type, 1, 1, null, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.NEAREST, gl.NEAREST);
      this.framebufferTexture2D(framebuffer, gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const result = this.checkFramebufferStatus(framebuffer) === gl.FRAMEBUFFER_COMPLETE;
      this.deleteFramebuffer(framebuffer);
      this.deleteTexture(texture);
      return result;
    }
  
    checkFramebufferStatus(framebuffer) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.changedParameters['framebuffer'] = framebuffer;
      return this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    }
  
    getShaderPrecisionFormat(shaderType, precisionType) {
      return this.gl.getShaderPrecisionFormat(shaderType, precisionType);
    }
  
    hasHalfFloatTextureSupport() {
      const ext = this.getExtension('OES_texture_half_float');
      if (ext === null) return false;
      if (this.getExtension('OES_texture_half_float_linear') === null) return false;
      if (!this.canRenderToTexture(ext.HALF_FLOAT_OES)) return false;
      return true;
    }
  
    hasFloatTextureSupport() {
      if (this.getExtension('OES_texture_float') === null || this.getExtension('OES_texture_float_linear') === null) return false;
      if (!this.canRenderToTexture(this.FLOAT)) return false;
      return true;
    }
  
    // --- state resolution ---
    resolveState(state, flag) {
      const gl = this.gl;
  
      // reset states that are currently set but not present in incoming state
      for (const parameterName in this.changedParameters) {
        if (this.changedParameters.hasOwnProperty(parameterName)) {
          if (!state.changedParameters.hasOwnProperty(parameterName)) {
            if (this.parameters[parameterName][flag]) {
              this.parameters[parameterName].setter.apply(gl, this.parameters[parameterName].defaults);
              delete this.changedParameters[parameterName];
            }
          }
        }
      }
  
      // apply incoming states (diff by value arrays)
      for (const parameterName in state.changedParameters) {
        if (state.changedParameters.hasOwnProperty(parameterName)) {
          if (
            !this.changedParameters.hasOwnProperty(parameterName) ||
            !arraysEqual(this.changedParameters[parameterName], state.changedParameters[parameterName])
          ) {
            this.changedParameters[parameterName] = state.changedParameters[parameterName];
            this.parameters[parameterName].setter.apply(gl, this.changedParameters[parameterName]);
          }
        }
      }
    }
  
    resolveDrawState(drawState) {
      this.resolveState(drawState, 'usedInDraw');
  
      // uniforms (no diffing)
      const program = drawState.changedParameters.program[0];
      for (const uniformName in drawState.uniforms) {
        if (drawState.uniforms.hasOwnProperty(uniformName)) {
          const args = [program.uniformLocations[uniformName]].concat(drawState.uniforms[uniformName].value);
          this.uniformSetters[drawState.uniforms[uniformName].type].apply(this.gl, args);
        }
      }
    }
  
    drawArrays(drawState, mode, first, count) {
      this.resolveDrawState(drawState);
      this.gl.drawArrays(mode, first, count);
    }
  
    drawElements(drawState, mode, count, type, offset) {
      this.resolveDrawState(drawState);
      this.gl.drawElements(mode, count, type, offset);
    }
  
    resolveClearState(clearState) { this.resolveState(clearState, 'usedInClear'); }
    clear(clearState, bit) { this.resolveClearState(clearState); this.gl.clear(bit); }
  
    resolveReadState(readState) { this.resolveState(readState, 'usedInRead'); }
    readPixels(readState, x, y, width, height, format, type, pixels) {
      this.resolveReadState(readState);
      this.gl.readPixels(x, y, width, height, format, type, pixels);
    }
  
    finish() { this.gl.finish(); return this; }
    flush() { this.gl.flush(); return this; }
    getError() { return this.gl.getError(); }
  
    createFramebuffer() { return this.gl.createFramebuffer(); }
  
    framebufferTexture2D(framebuffer, target, attachment, textarget, texture, level) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.changedParameters['framebuffer'] = framebuffer;
      this.gl.framebufferTexture2D(target, attachment, textarget, texture, level);
      return this;
    }
  
    framebufferRenderbuffer(framebuffer, target, attachment, renderbuffertarget, renderbuffer) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.changedParameters['framebuffer'] = framebuffer;
      this.gl.framebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer);
    }
  
    drawBuffers(framebuffer, buffers) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.changedParameters['framebuffer'] = framebuffer;
      // lazy-get WEBGL_draw_buffers (tiny robustness tweak vs original)
      this.drawExt = this.drawExt || this.gl.getExtension('WEBGL_draw_buffers');
      if (!this.drawExt) throw new Error('WEBGL_draw_buffers not supported');
      this.drawExt.drawBuffersWEBGL(buffers);
    }
  
    createTexture() { return this.gl.createTexture(); }
  
    bindTextureForEditing(target, texture) {
      this.gl.activeTexture(this.gl.TEXTURE0 + this.defaultTextureUnit);
      this.gl.bindTexture(target, texture);
      this.changedParameters['texture' + this.defaultTextureUnit.toString()] = [target, texture];
    }
  
    // texImage2D overloads
    texImage2D(target, texture, ...args) {
      this.bindTextureForEditing(target, texture);
      this.gl.texImage2D(target, ...args);
      return this;
    }
  
    // texSubImage2D overloads
    texSubImage2D(target, texture, ...args) {
      this.bindTextureForEditing(target, texture);
      this.gl.texSubImage2D(target, ...args);
      return this;
    }
  
    texParameteri(target, texture, pname, param) {
      this.bindTextureForEditing(target, texture);
      this.gl.texParameteri(target, pname, param);
      return this;
    }
  
    texParameterf(target, texture, pname, param) {
      this.bindTextureForEditing(target, texture);
      this.gl.texParameterf(target, pname, param);
      return this;
    }
  
    pixelStorei(target, texture, pname, param) {
      this.bindTextureForEditing(target, texture);
      this.gl.pixelStorei(pname, param);
      return this;
    }
  
    setTextureFiltering(target, texture, wrapS, wrapT, minFilter, magFilter) {
      const gl = this.gl;
      this.bindTextureForEditing(target, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
      return this;
    }
  
    generateMipmap(target, texture) {
      this.bindTextureForEditing(target, texture);
      this.gl.generateMipmap(target);
      return this;
    }
  
    buildTexture(format, type, width, height, data, wrapS, wrapT, minFilter, magFilter) {
      const texture = this.createTexture();
      this.rebuildTexture(texture, format, type, width, height, data, wrapS, wrapT, minFilter, magFilter);
      return texture;
    }
  
    rebuildTexture(texture, format, type, width, height, data, wrapS, wrapT, minFilter, magFilter) {
      this.texImage2D(this.TEXTURE_2D, texture, 0, format, width, height, 0, format, type, data)
        .setTextureFiltering(this.TEXTURE_2D, texture, wrapS, wrapT, minFilter, magFilter);
      return this;
    }
  
    createRenderbuffer() { return this.gl.createRenderbuffer(); }
  
    renderbufferStorage(renderbuffer, target, internalformat, width, height) {
      this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, renderbuffer);
      this.gl.renderbufferStorage(target, internalformat, width, height);
      return this;
    }
  
    createBuffer() { return this.gl.createBuffer(); }
  
    bufferData(buffer, target, data, usage) {
      const gl = this.gl;
      if (target === gl.ELEMENT_ARRAY_BUFFER) {
        this.changedParameters.indexBuffer = [buffer];
      }
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, data, usage);
    }
  
    buildBuffer(target, data, usage) {
      const buffer = this.createBuffer();
      this.bufferData(buffer, target, data, usage);
      return buffer;
    }
  
    bufferSubData(buffer, target, offset, data) {
      const gl = this.gl;
      if (target === gl.ELEMENT_ARRAY_BUFFER) {
        this.changedParameters.indexBuffer = [buffer];
      }
      gl.bindBuffer(target, buffer);
      gl.bufferSubData(target, offset, data);
    }
  
    createProgram(vertexShaderSource, fragmentShaderSource, attributeLocations) {
      return new WrappedProgram(this, vertexShaderSource, fragmentShaderSource, attributeLocations);
    }
  
    // async file loading utilities
    static loadTextFiles(filenames, onLoaded) {
      let loadedSoFar = 0;
      const results = {};
      for (let i = 0; i < filenames.length; ++i) {
        const name = filenames[i];
        const request = new XMLHttpRequest();
        request.onreadystatechange = function () {
          if (request.readyState === 4) {
            results[name] = request.responseText;
            loadedSoFar += 1;
            if (loadedSoFar === filenames.length) onLoaded(results);
          }
        };
        request.open('GET', name, true);
        request.send();
      }
    }
  
    createProgramFromFiles(vertexShaderPath, fragmentShaderPath, attributeLocations, successCallback, failureCallback) {
      let filesToLoad = [];
      if (Array.isArray(vertexShaderPath)) filesToLoad = filesToLoad.concat(vertexShaderPath);
      else filesToLoad.push(vertexShaderPath);
      if (Array.isArray(fragmentShaderPath)) filesToLoad = filesToLoad.concat(fragmentShaderPath);
      else filesToLoad.push(fragmentShaderPath);
  
      WrappedGL.loadTextFiles(filesToLoad, (files) => {
        const vSources = Array.isArray(vertexShaderPath)
          ? vertexShaderPath.map((p) => files[p])
          : [files[vertexShaderPath]];
        const fSources = Array.isArray(fragmentShaderPath)
          ? fragmentShaderPath.map((p) => files[p])
          : [files[fragmentShaderPath]];
  
        const program = this.createProgram(vSources.join('\n'), fSources.join('\n'), attributeLocations);
        successCallback(program);
      });
    }
  
    createProgramsFromFiles(programParameters, successCallback, failureCallback) {
      const programCount = keysInObject(programParameters);
      let loadedSoFar = 0;
      const programs = {};
      for (const programName in programParameters) {
        if (programParameters.hasOwnProperty(programName)) {
          const params = programParameters[programName];
          this.createProgramFromFiles(
            params.vertexShader,
            params.fragmentShader,
            params.attributeLocations,
            (program) => {
              programs[programName] = program;
              loadedSoFar += 1;
              if (loadedSoFar === programCount) successCallback(programs);
            },
            failureCallback
          );
        }
      }
    }
  
    createDrawState() { return new DrawState(this); }
    createClearState() { return new ClearState(this); }
    createReadState() { return new ReadState(this); }
  
    deleteBuffer(buffer) { this.gl.deleteBuffer(buffer); }
    deleteFramebuffer(buffer) { this.gl.deleteFramebuffer(buffer); }
    deleteTexture(texture) { this.gl.deleteTexture(texture); }
  }
  
  // If using modules:
  // export default WrappedGL;
  