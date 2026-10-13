'use strict';
// Evaluate the existing browser manifests, not a third inventory or a regex
// copy of their syntax. No engine is constructed and the engine still does no I/O.
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function readShaderTrees(root) {
  const context = vm.createContext({});
  for (const file of ['fluid-engine/index.js', 'common.js']) {
    vm.runInContext(await fs.readFile(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('shaderTrees()', context);
}

async function makeShaderRegistry(root, trees) {
  trees = trees || await readShaderTrees(root);
  const registry = Object.create(null);
  const logical = new Set();
  for (const tree of trees) {
    for (const name of tree.files) {
      const key = tree.basePath + name;
      if (Object.hasOwn(registry, key) || logical.has(name)) {
        throw new Error(`Shader key collision: ${key} (logical ${name})`);
      }
      if (path.isAbsolute(key) || key.includes('\\') || key.split('/').includes('..')) {
        throw new Error(`Invalid shader path: ${key}`);
      }
      let text;
      try { text = await fs.readFile(path.join(root, key), 'utf8'); }
      catch (error) { throw new Error(`Missing/unreadable shader: ${key}: ${error.message}`); }
      if (!text.trim()) throw new Error(`Empty shader: ${key}`);
      registry[key] = text;
      logical.add(name);
    }
  }
  return registry;
}

async function writeShaderRegistry(root, target) {
  const registry = await makeShaderRegistry(root);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // JSON preserves every GLSL newline/directive. JS minification does not
  // minify these string contents. Escape line separators for JS consumers.
  const json = JSON.stringify(registry).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  await fs.writeFile(target, `globalThis.FLUID_SHADER_SOURCES = ${json};\n`);
}
module.exports = { readShaderTrees, makeShaderRegistry, writeShaderRegistry };
