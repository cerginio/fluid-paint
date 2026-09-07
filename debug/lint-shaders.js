#!/usr/bin/env node
'use strict';

/*
 * Shader + texture lint. Guards the two bug classes documented in
 * docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md so they cannot silently return.
 *
 *   1. FLOAT textures created with LINEAR filtering.
 *      Incomplete on GPUs without OES_texture_float_linear -- every fetch
 *      returns vec4(0,0,0,1). This is what collapsed the bristles.
 *
 *   2. Shaders declaring mediump (or nothing).
 *      mediump is 10-bit on mobile vs 23-bit on desktop. At a canvas
 *      coordinate of 1024 the fp16 ulp is 1.0, while the bristle segment
 *      spacing at scale 1 is 0.5 -- the geometry is unrepresentable.
 *
 * Usage:  node debug/lint-shaders.js
 * Exit code 1 on any finding, so it can gate CI.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const findings = [];

// ---- 1. FLOAT + LINEAR texture creation ------------------------------------
// Matches buildTexture/rebuildTexture calls carrying both FLOAT and LINEAR,
// across the multi-line argument style the codebase uses.
// The engine moved into fluid-engine/ in Phase 3, and it is where most texture
// creation lives -- scanning only the root would silently check nothing that
// matters.
const jsFiles = [];
for (const dir of [root, path.join(root, 'fluid-engine'), path.join(root, 'fluid-engine', 'gl')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    jsFiles.push(path.join(dir, f));
  }
}

for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /\b(?:re)?buildTexture\s*\(([\s\S]{0,400}?)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const args = m[1];
    if (/\bFLOAT\b/.test(args) && /\bLINEAR\b/.test(args)) {
      const line = src.slice(0, m.index).split('\n').length;
      findings.push(
        `${path.relative(root, file).replace(/\\/g, '/')}:${line}  FLOAT texture created with LINEAR filtering.\n` +
        `    Incomplete without OES_texture_float_linear; fetches return vec4(0,0,0,1).\n` +
        `    Use NEAREST and interpolate in the shader (see shaders/advect.frag).`
      );
    }
  }
}

// ---- 2. shader precision ----------------------------------------------------
const shaderDir = path.join(root, 'fluid-engine', 'shaders');
for (const file of fs.readdirSync(shaderDir).filter((f) => /\.(frag|vert)$/.test(f))) {
  const src = fs.readFileSync(path.join(shaderDir, file), 'utf8');
  if (/precision\s+mediump\s+float/.test(src)) {
    findings.push(
      `shaders/${file}  declares 'precision mediump float'.\n` +
      `    mediump is 10-bit on mobile (23-bit on desktop). Use highp.`
    );
  } else if (!/precision\s+highp\s+float/.test(src)) {
    findings.push(
      `shaders/${file}  has no float precision declaration.\n` +
      `    Add 'precision highp float;' -- the default differs across stages and devices.`
    );
  }
}

if (findings.length === 0) {
  console.log('shader lint: OK (no FLOAT+LINEAR textures, all shaders highp)');
  process.exit(0);
}

console.error('shader lint: ' + findings.length + ' finding(s)\n');
for (const f of findings) console.error('  ' + f + '\n');
process.exit(1);
