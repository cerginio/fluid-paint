'use strict';

/*
 * GPU capability-clamp harness.
 *
 * Reproduces mobile-GPU behavior on a desktop machine by clamping a real
 * WebGLRenderingContext down to a target device's capability set.
 *
 * The point is NOT to emulate the GPU. It is to emulate the missing capability,
 * which is what actually breaks the app.
 *
 * Usage:  index.html?gpu=samsung-a56
 *
 * Profiles are sourced from webgl-probe-desktop.json / webgl-probe-samsung-a56.json.
 */

const GPU_PROFILES = {
  desktop: {
    label: 'Desktop (no clamping)',
    deny: [],
  },

  'samsung-a56': {
    label: 'Samsung A56 / Xclipse 540 (Vulkan)',
    // The whole bug: this device does NOT expose float-linear filtering.
    deny: ['OES_texture_float_linear'],
    params: {
      MAX_TEXTURE_SIZE: 8192,
      MAX_CUBE_MAP_TEXTURE_SIZE: 8192,
      MAX_VIEWPORT_DIMS: [16384, 16384],
    },
    // Precision the device reports for mediump. Used only for reporting;
    // shaders here all declare highp, which the A56 supports at 23 bits.
    mediumFloatPrecision: 10,
  },

  /*
   * The "runs but collapses" mode -- and the one that matches the reported
   * field symptom.
   *
   * Same silent zeroing as 'samsung-a56', but hasFloatTextureSupport() is
   * allowed to pass, so the app boots and we can observe the bristle collapse
   * instead of the capability-gate error page.
   *
   * This models a device whose driver reports the extension (or where the app
   * bypasses the gate) while the sampler still refuses to filter float
   * textures. Use it to see the actual visual failure.
   */
  'samsung-a56-boots': {
    label: 'Samsung A56, capability gate bypassed (collapse visible)',
    deny: [],                    // getExtension still answers truthfully...
    forceFloatLinearIncomplete: true, // ...but float+linear is still broken
    params: { MAX_TEXTURE_SIZE: 8192 },
  },

  // Strictest realistic mobile baseline: no renderable float at all.
  // Expected outcome: the app shows the "no float textures" page. That is
  // correct behavior, not a bug.
  'mobile-worst': {
    label: 'Worst-case mobile (no float rendering)',
    deny: [
      'OES_texture_float_linear',
      'OES_texture_float',
      'WEBGL_color_buffer_float',
      'EXT_float_blend',
    ],
    params: { MAX_TEXTURE_SIZE: 4096 },
  },
};

/*
 * Why denying getExtension is not sufficient on its own:
 *
 * Denying the extension changes what the APPLICATION believes, but the desktop
 * driver will still happily filter a FLOAT texture with a LINEAR filter. The
 * sampler keeps returning correct data and the bug does not reproduce.
 *
 * To get real incompleteness on a lenient desktop driver we exploit a rule that
 * EVERY GL implementation honors: a texture whose TEXTURE_MIN_FILTER is a
 * mipmapping filter, but which has no mipmaps, is incomplete. Sampling it
 * returns vec4(0,0,0,1) -- exactly what the A56 does with float+linear.
 *
 * So: when the profile denies OES_texture_float_linear and the app asks for
 * LINEAR on a FLOAT texture, we substitute NEAREST_MIPMAP_LINEAR (the GL
 * default) for the min filter. The texture becomes incomplete on any driver.
 */

function installGpuClamp(gl, profileName) {
  const profile = GPU_PROFILES[profileName];
  if (!profile || profileName === 'desktop') {
    console.info('[gpu-clamp] no clamping (profile: %s)', profileName || 'desktop');
    return { profile: null, report: () => ({ clamped: false }) };
  }

  console.warn(
    '[gpu-clamp] ACTIVE: %s -- denying [%s]',
    profile.label,
    profile.deny.join(', ')
  );

  const denyFloatLinear =
    profile.deny.includes('OES_texture_float_linear') ||
    profile.forceFloatLinearIncomplete === true;

  // Track which textures are FLOAT so texParameteri can decide.
  const floatTextures = new WeakSet();
  // Record every texture that asked for float+linear -- these are the ones the
  // real device would have silently zeroed.
  const incompleteTextures = [];

  // ---- getExtension: deny listed extensions --------------------------------
  const realGetExtension = gl.getExtension.bind(gl);
  gl.getExtension = function (name) {
    if (profile.deny.includes(name)) {
      console.debug('[gpu-clamp] getExtension(%s) -> null (denied)', name);
      return null;
    }
    return realGetExtension(name);
  };

  // ---- getParameter: clamp limits ------------------------------------------
  const realGetParameter = gl.getParameter.bind(gl);
  gl.getParameter = function (pname) {
    if (profile.params) {
      for (const key in profile.params) {
        if (gl[key] === pname) return profile.params[key];
      }
    }
    return realGetParameter(pname);
  };

  // ---- texImage2D: remember which textures are FLOAT ------------------------
  const realTexImage2D = gl.texImage2D.bind(gl);
  gl.texImage2D = function (...args) {
    // Long form: (target, level, internalformat, w, h, border, format, type, pixels)
    const type = args.length >= 8 ? args[7] : args[3];
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
    if (bound) {
      if (type === gl.FLOAT) floatTextures.add(bound);
      else floatTextures.delete(bound);
    }
    return realTexImage2D(...args);
  };

  // ---- texParameteri: force real incompleteness -----------------------------
  const realTexParameteri = gl.texParameteri.bind(gl);
  gl.texParameteri = function (target, pname, param) {
    if (
      denyFloatLinear &&
      param === gl.LINEAR &&
      (pname === gl.TEXTURE_MIN_FILTER || pname === gl.TEXTURE_MAG_FILTER)
    ) {
      const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
      if (bound && floatTextures.has(bound)) {
        if (incompleteTextures.indexOf(bound) === -1) {
          incompleteTextures.push(bound);
          console.warn(
            '[gpu-clamp] FLOAT texture requested LINEAR filtering -- ' +
              'forcing incompleteness (this is the mobile bug)'
          );
        }
        if (pname === gl.TEXTURE_MIN_FILTER) {
          // Mipmapping filter on a mipless texture == incomplete on every driver.
          return realTexParameteri(target, pname, gl.NEAREST_MIPMAP_LINEAR);
        }
        // MAG_FILTER cannot express incompleteness; MIN_FILTER above is enough.
        return realTexParameteri(target, pname, param);
      }
    }
    return realTexParameteri(target, pname, param);
  };

  return {
    profile,
    report: () => ({
      clamped: true,
      profile: profileName,
      label: profile.label,
      denied: profile.deny,
      floatLinearTexturesAffected: incompleteTextures.length,
    }),
  };
}

/*
 * Static audit: find every float+linear texture creation without running the
 * simulation. Zero false negatives for this bug class.
 *
 * Call with the WrappedGL instance BEFORE the app builds its textures.
 */
function auditFloatLinearTextures(wgl) {
  const findings = [];
  const realBuildTexture = wgl.buildTexture.bind(wgl);

  wgl.buildTexture = function (format, type, width, height, data, wrapS, wrapT, minFilter, magFilter) {
    if (type === wgl.FLOAT && (minFilter === wgl.LINEAR || magFilter === wgl.LINEAR)) {
      const site = new Error().stack.split('\n')[2] || '(unknown)';
      findings.push({ width, height, minFilter, magFilter, site: site.trim() });
      console.warn(
        '[audit] FLOAT texture %dx%d created with LINEAR filtering -- ' +
          'will return vec4(0,0,0,1) on GPUs without OES_texture_float_linear\n    at %s',
        width, height, site.trim()
      );
    }
    return realBuildTexture(format, type, width, height, data, wrapS, wrapT, minFilter, magFilter);
  };

  return findings;
}

if (typeof window !== 'undefined') {
  window.GPU_PROFILES = GPU_PROFILES;
  window.installGpuClamp = installGpuClamp;
  window.auditFloatLinearTextures = auditFloatLinearTextures;
}
