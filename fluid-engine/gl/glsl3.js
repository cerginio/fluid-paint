'use strict';

/*
 * GLSL ES 1.00 -> 3.00 transpiler. Shaders are written once in ES 1.00 and
 * translated at program-creation time (WrappedGL.createProgram(), the single
 * choke point) rather than forked into a parallel WebGL 2 set to keep in sync.
 *
 * Why WebGL 2 at all: it makes texelFetch() available, which takes no sampler
 * filter, so a filter/format mismatch on a PBD state-texture read can't
 * silently zero the fetch. See docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md §5.
 *
 * The translation is a token-level rewrite of the constructs this codebase
 * actually uses, not a general GLSL parser.
 */

const GLSL3 = (function () {

  // Comments and string-free GLSL make this safe enough for the rewrites below,
  // but we still avoid touching anything inside a comment.
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  }

  /*
   * Which sampler uniforms are sampled with an explicitly-integer texel
   * coordinate? We do not try to infer that -- instead every texture2D() is
   * translated to texture(), and the call sites that want exact texel reads
   * opt in by writing texelFetch2D() in the ES 1.00 source (see below).
   */

  /*
   * texelFetch2D(sampler, uv, resolution)
   *
   * A shim the ES 1.00 sources can call. It means: "read exactly the texel that
   * `uv` lands in, no filtering".
   *   - WebGL 2  -> texelFetch(sampler, ivec2(uv * resolution), 0)
   *   - WebGL 1  -> texture2D(sampler, uv)   (correct as long as the texture is
   *                 NEAREST, which is what the WebGL 1 fix already guarantees)
   *
   * This is what makes the two paths share one source: the intent is written
   * once, and each backend expresses it in its own strongest form.
   */
  const TEXEL_FETCH_ES1 = [
    'vec4 texelFetch2D(sampler2D tex, vec2 uv, vec2 resolution) {',
    '    return texture2D(tex, uv);',
    '}',
    '',
  ].join('\n');

  const TEXEL_FETCH_ES3 = [
    'vec4 texelFetch2D(sampler2D tex, vec2 uv, vec2 resolution) {',
    '    return texelFetch(tex, ivec2(uv * resolution), 0);',
    '}',
    '',
  ].join('\n');

  /*
   * Split a source into (directive prologue, body).
   *
   * Callers prepend "#define FOO \n" before the shader text, and #version must
   * be the very first line in an ES 3.00 shader, so the two have to be
   * reordered rather than concatenated naively.
   */
  function splitDirectives(src) {
    const lines = src.split('\n');
    const directives = [];
    let i = 0;
    for (; i < lines.length; ++i) {
      const line = lines[i].trim();
      if (line === '') { directives.push(lines[i]); continue; }
      if (line.startsWith('#define') || line.startsWith('#extension')) {
        directives.push(lines[i]);
        continue;
      }
      break;
    }
    return { directives: directives.join('\n'), body: lines.slice(i).join('\n') };
  }

  function hasToken(src, token) {
    return new RegExp('\\b' + token + '\\b').test(src);
  }

  /*
   * Translate one shader to GLSL ES 3.00.
   *
   * type: 'vertex' | 'fragment'
   */
  function toES3(source, type) {
    const split = splitDirectives(source);
    let body = split.body;

    const scan = stripComments(body);
    const usesTexelFetch2D = hasToken(scan, 'texelFetch2D');

    // ---- storage qualifiers ----
    if (type === 'vertex') {
      body = body.replace(/\battribute\b/g, 'in');
      body = body.replace(/\bvarying\b/g, 'out');
    } else {
      body = body.replace(/\bvarying\b/g, 'in');
    }

    // ---- texture lookups ----
    // texture2D/textureCube collapse onto the overloaded texture().
    body = body.replace(/\btexture2DLodEXT\b/g, 'textureLod');
    body = body.replace(/\btexture2DLod\b/g, 'textureLod');
    body = body.replace(/\btexture2DProj\b/g, 'textureProj');
    body = body.replace(/\btexture2D\b/g, 'texture');
    body = body.replace(/\btextureCube\b/g, 'texture');

    // ---- fragment output ----
    if (type === 'fragment') {
      if (hasToken(scan, 'gl_FragColor')) {
        body = body.replace(/\bgl_FragColor\b/g, 'fragColor');
      }
      // gl_FragData[0] -> fragColor (the codebase only ever uses index 0)
      body = body.replace(/\bgl_FragData\s*\[\s*0\s*\]/g, 'fragColor');
    }

    // ---- assemble ----
    // Declaration order matters: #version first, then the caller's #defines,
    // then the source's own `precision` line -- anything declaring a float must
    // come AFTER it, or ES 3.00 rejects it with "No precision specified".
    // So the injected declarations are spliced in just past the precision line
    // rather than prepended.
    const injected = [];
    if (type === 'fragment') {
      injected.push('precision highp int;');
      injected.push('out vec4 fragColor;');
    }
    if (usesTexelFetch2D) injected.push(TEXEL_FETCH_ES3);

    if (injected.length > 0) {
      const precisionRe = /^[ \t]*precision\s+\w+\s+float\s*;[ \t]*$/m;
      const m = body.match(precisionRe);
      if (m) {
        const idx = body.indexOf(m[0]) + m[0].length;
        body = body.slice(0, idx) + '\n' + injected.join('\n') + '\n' + body.slice(idx);
      } else {
        // No precision line of its own -- supply one, then the declarations.
        body = 'precision highp float;\n' + injected.join('\n') + '\n' + body;
      }
    }

    const out = ['#version 300 es'];
    if (split.directives.trim() !== '') out.push(split.directives);
    out.push(body);
    return out.join('\n');
  }

  /*
   * The WebGL 1 path: source is already ES 1.00, we only need to supply the
   * texelFetch2D shim when it is used.
   */
  function toES1(source, type) {
    const split = splitDirectives(source);
    const scan = stripComments(split.body);
    if (!hasToken(scan, 'texelFetch2D')) return source;

    const out = [];
    if (split.directives.trim() !== '') out.push(split.directives);

    // The shim references texture2D, so it must come after any precision
    // declaration. Insert it right after the precision line when there is one.
    const body = split.body;
    const m = body.match(/^[ \t]*precision\s+\w+\s+float\s*;[ \t]*$/m);
    if (m) {
      const idx = body.indexOf(m[0]) + m[0].length;
      out.push(body.slice(0, idx) + '\n\n' + TEXEL_FETCH_ES1 + body.slice(idx));
    } else {
      out.push(TEXEL_FETCH_ES1 + body);
    }
    return out.join('\n');
  }

  return {
    toES3: toES3,
    toES1: toES1,
    // exposed for tests
    splitDirectives: splitDirectives,
  };
})();

if (typeof window !== 'undefined') window.GLSL3 = GLSL3;
if (typeof module !== 'undefined' && module.exports) module.exports = GLSL3;
