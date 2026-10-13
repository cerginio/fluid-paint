'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { readShaderTrees, makeShaderRegistry, writeShaderRegistry } = require('./shader-bundle-build');
const root = path.resolve(__dirname, '..');
async function loader(extra = {}) {
  const requests = [];
  class XHR {
    constructor() { requests.push(this); }
    open(method, url) { this.url = url; }
    send() {}
    getResponseHeader() { return this.contentType || 'text/plain'; }
    respond(status = 200, text = 'void main() {}\n') {
      this.status = status; this.responseText = text; this.onload();
    }
  }
  const context = vm.createContext({ XMLHttpRequest: XHR, ...extra });
  for (const file of ['common.js', 'fluid-engine/gl/wrappedgl.js'])
    vm.runInContext(await fs.readFile(path.join(root, file), 'utf8'), context);
  return { requests, trees: vm.runInContext('loadShaderTrees', context),
    files: vm.runInContext('WrappedGL.loadTextFiles', context) };
}
const trees = [{ basePath: 'engine/', files: ['shaders/a.frag'] },
  { basePath: 'app/', files: ['shaders/b.vert'] }];
function callbacks() {
  const state = { success: 0, failure: 0 };
  return { state, ok: (value) => { state.success++; state.value = value; },
    bad: (error) => { state.failure++; state.error = error.message; } };
}
test('registry exactly matches live manifests and preserves text/newlines/directives', async () => {
  const manifests = await readShaderTrees(root);
  const registry = await makeShaderRegistry(root);
  assert.deepEqual(Object.keys(registry).sort(), Array.from(manifests).flatMap(t => Array.from(t.files, n => t.basePath + n)).sort());
  for (const [key, text] of Object.entries(registry)) assert.equal(text, await fs.readFile(path.join(root, key), 'utf8'));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluid-shader-unit-'));
  try {
    const target = path.join(temp, 'registry.js'); await writeShaderRegistry(root, target);
    const context = vm.createContext({}); vm.runInContext(await fs.readFile(target, 'utf8'), context);
    for (const key of Object.keys(registry)) assert.equal(context.FLUID_SHADER_SOURCES[key], registry[key]);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
for (const kind of ['missing', 'empty', 'physical collision', 'logical collision']) {
  test(`build refuses ${kind} with exact path`, async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fluid-shader-negative-'));
    try {
      await fs.mkdir(path.join(temp, 'engine/shaders'), { recursive: true });
      if (kind !== 'missing') await fs.writeFile(path.join(temp, 'engine/shaders/a.frag'), kind === 'empty' ? ' \n' : '#define TEST 1\n');
      const input = [{ basePath: 'engine/', files: ['shaders/a.frag'] }];
      if (kind === 'physical collision') input[0].files.push('shaders/a.frag');
      if (kind === 'logical collision') input.push({ basePath: 'app/', files: ['shaders/a.frag'] });
      await assert.rejects(makeShaderRegistry(temp, input), /(?:engine|app)\/shaders\/a.frag/);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });
}
test('registry maps physical to retained logical keys, never XHR', async () => {
  const api = await loader({ FLUID_SHADER_SOURCES: { 'engine/shaders/a.frag': 'a\n', 'app/shaders/b.vert': 'b\n' } });
  const c = callbacks(); api.trees(trees, c.ok, c.bad);
  assert.equal(c.state.success, 1); assert.equal(c.state.failure, 0);
  assert.equal(c.state.value['shaders/a.frag'], 'a\n'); assert.equal(api.requests.length, 0);
});
for (const registry of [null, {}, { 'engine/shaders/a.frag': ' ' }, { 'engine/shaders/a.frag': 3 }]) {
  test(`present invalid registry ${JSON.stringify(registry)} fails once without fallback`, async () => {
    const api = await loader({ FLUID_SHADER_SOURCES: registry }); const c = callbacks();
    api.trees(trees, c.ok, c.bad);
    assert.equal(c.state.failure, 1); assert.equal(c.state.success, 0); assert.equal(api.requests.length, 0);
    assert.match(c.state.error, /engine\/shaders\/a.frag/);
  });
}
test('empty files, empty trees, and trees containing empty files complete once', async () => {
  const api = await loader();
  for (const run of [c => api.files([], c.ok, '', c.bad), c => api.trees([], c.ok, c.bad),
    c => api.trees([{ files: [], basePath: '' }, { files: [], basePath: '' }], c.ok, c.bad)]) {
    const c = callbacks(); run(c); assert.equal(c.state.success, 1); assert.equal(c.state.failure, 0);
  }
  assert.equal(api.requests.length, 0);
});
test('source successes aggregate once despite repeated events and out-of-order responses', async () => {
  const api = await loader(); const c = callbacks(); api.trees(trees, c.ok, c.bad);
  api.requests[1].respond(); api.requests[1].respond(); api.requests[1].onerror();
  assert.equal(c.state.success, 0); api.requests[0].respond(); api.requests[0].respond();
  assert.equal(c.state.success, 1); assert.equal(c.state.failure, 0);
});
for (const reason of ['404', '500', 'status0', 'empty', 'html200', 'htmlBody', 'network', 'abort', 'timeout']) {
  test(`source ${reason} propagates once and prevents late success`, async () => {
    const api = await loader(); const c = callbacks(); api.trees(trees, c.ok, c.bad);
    const request = api.requests[0];
    if (reason === 'network') request.onerror();
    else if (reason === 'abort') request.onabort();
    else if (reason === 'timeout') request.ontimeout();
    else if (reason === 'empty') request.respond(200, ' \n');
    else if (reason.startsWith('html')) { request.contentType = reason === 'html200' ? 'text/html' : 'text/plain'; request.respond(200, '<!doctype html><html>404</html>'); }
    else request.respond(reason === 'status0' ? 0 : Number(reason));
    request.onerror(); request.respond(); api.requests[1].respond();
    assert.equal(c.state.failure, 1); assert.equal(c.state.success, 0);
    assert.match(c.state.error, /engine\/shaders\/a.frag/);
  });
}
test('runtime logical collision fails before XHR', async () => {
  const api = await loader(); const c = callbacks();
  api.trees([trees[0], { basePath: 'other/', files: ['shaders/a.frag'] }], c.ok, c.bad);
  assert.equal(c.state.failure, 1); assert.equal(api.requests.length, 0);
});

for (const kind of ['missing', 'empty', 'collision']) {
  test(`actual gulp build exits nonzero for ${kind} (isolated Temp fixture)`, async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), `fluid-2-C-build-${kind}-`));
    for (const file of ['gulpfile.js', 'common.js', 'fluid-engine/index.js', 'debug/shader-bundle-build.js']) {
      await fs.mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
      await fs.copyFile(path.join(root, file), path.join(fixture, file));
    }
    const registry = await makeShaderRegistry(root);
    for (const [key, text] of Object.entries(registry)) {
      await fs.mkdir(path.dirname(path.join(fixture, key)), { recursive: true });
      await fs.writeFile(path.join(fixture, key), text);
    }
    if (kind === 'missing') await fs.unlink(path.join(fixture, 'fluid-engine/shaders/splat.vert'));
    if (kind === 'empty') await fs.writeFile(path.join(fixture, 'fluid-engine/shaders/splat.vert'), ' \n');
    if (kind === 'collision') {
      const common = path.join(fixture, 'common.js');
      await fs.writeFile(common, (await fs.readFile(common, 'utf8')).replace('const APP_SHADERS = [', "const APP_SHADERS = [\n 'shaders/splat.vert',"));
    }
    const command = spawnSync(process.execPath, [path.join(root, 'node_modules/gulp/bin/gulp.js'), '--gulpfile', path.join(fixture, 'gulpfile.js'), 'build'],
      { cwd: fixture, env: { ...process.env, NODE_PATH: path.join(root, 'node_modules'), NODE_ENV: 'production' }, encoding: 'utf8' });
    await fs.writeFile(path.join(fixture, 'stdout.log'), command.stdout || '');
    await fs.writeFile(path.join(fixture, 'stderr.log'), command.stderr || '');
    await fs.writeFile(path.join(fixture, 'result.json'), JSON.stringify({ command: 'gulp build', exitCode: command.status, kind }, null, 2));
    console.log(`Build negative evidence: ${fixture}`);
    assert.notEqual(command.status, 0);
    assert.match(command.stderr + command.stdout, /(?:Missing\/unreadable shader|Empty shader|Shader key collision): .*shaders\/splat.vert/);
    assert.equal(await fs.stat(path.join(fixture, 'dist/bundle.js')).then(() => true, () => false), false);
  });
}
