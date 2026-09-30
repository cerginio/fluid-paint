'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const StoryFileLoader = require('../app/story-file-loader');
const StoryDemoCatalog = require('../app/story-demo-catalog');

const entry = Object.freeze({
  slug: 'story-8-frames-hibrid', title: 'Hybrid story', frameCount: 8,
  sizeBytes: 4093329, credit: 'Tilecraft fixtures', publishedAt: '2026-09-30T00:00:00Z',
});
const index = () => ({ schemaVersion: 1, generatedAt: '2026-09-30T00:00:00Z', stories: [{ ...entry }] });
const model = () => ({
  frames: Array.from({ length: 8 }, (_, i) => ({ id: i })),
  layers: [
    { visible: true, tileShape: 'polygon', tiles: [{ x: 3, y: 4, c: '#f00', v: 1 }] },
    { visible: true, tileShape: 'unknown', tiles: [{ x: 5, y: 6, c: '#0f0', v: 1 }] },
  ],
});
const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json', ...init.headers }, status: init.status || 200,
});

test('a validated index controls the only model URL and shares File preflight', async () => {
  const urls = [];
  const catalog = new StoryDemoCatalog(async (url, options) => {
    urls.push({ url, options });
    return url.endsWith('index.json') ? jsonResponse(index()) : jsonResponse(model());
  });
  const result = await catalog.refreshIndex();
  assert.equal(result.stories.length, 1);
  assert.equal(urls[0].url, `${StoryDemoCatalog.BASE_URL}index.json`);
  assert.equal(urls[0].options.cache, 'no-cache');
  assert.deepEqual(urls.map((request) => request.options.method), ['GET']);

  const loaded = await catalog.fetchStory(entry.slug);
  assert.equal(urls[1].url, `${StoryDemoCatalog.BASE_URL}${entry.slug}.json`);
  assert.equal(loaded.summary.framesTotal, 8);
  assert.equal(loaded.summary.drawableItems, 1);
  assert.equal(loaded.summary.warnings[0].code, 'unsupported-layers');
  assert.deepEqual(loaded.summary, StoryFileLoader.summarize(loaded.model,
    `${entry.slug}.json`, loaded.summary.byteSize));
  await assert.rejects(catalog.fetchStory('../admin'), /validated demo index/);
  await assert.rejects(catalog.fetchStory('unlisted-slug'), /validated demo index/);
  assert.equal(urls.length, 2);
});

test('network rejection retries the same index and model path on r2.dev', async () => {
  const requests = [];
  const catalog = new StoryDemoCatalog(async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith(StoryDemoCatalog.BASE_URL)) throw new TypeError('Failed to fetch');
    return url.endsWith('index.json') ? jsonResponse(index()) : jsonResponse(model());
  });
  await catalog.refreshIndex();
  const loaded = await catalog.fetchStory(entry.slug);
  assert.equal(loaded.summary.framesTotal, 8);
  assert.deepEqual(requests.map(({ url }) => url), [
    `${StoryDemoCatalog.BASE_URL}index.json`,
    `${StoryDemoCatalog.FALLBACK_URL}index.json`,
    `${StoryDemoCatalog.BASE_URL}${entry.slug}.json`,
    `${StoryDemoCatalog.FALLBACK_URL}${entry.slug}.json`,
  ]);
  assert.equal(requests[0].options, requests[1].options);
  assert.equal(requests[0].options.cache, 'no-cache');
  assert.equal(requests[2].options, requests[3].options);
});

test('HTTP, invalid JSON, and abort do not trigger the fallback', async () => {
  const urls = [];
  const catalog = new StoryDemoCatalog(async (url) => {
    urls.push(url);
    if (urls.length === 1) return jsonResponse(index());
    if (urls.length === 2) return new Response('{}', { status: 404,
      headers: { 'Content-Type': 'application/json' } });
    if (urls.length === 3) return new Response('{', {
      headers: { 'Content-Type': 'application/json' } });
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
  const first = await catalog.refreshIndex();
  await assert.rejects(catalog.refreshIndex(), /HTTP 404/);
  await assert.rejects(catalog.refreshIndex(), /valid JSON/);
  await assert.rejects(catalog.refreshIndex(), { name: 'AbortError' });
  assert.equal(catalog.index, first);
  assert.equal(urls.length, 4);
  assert.ok(urls.every((url) => url === `${StoryDemoCatalog.BASE_URL}index.json`));
});

test('a failed refresh keeps the last validated catalog', async () => {
  let next = index();
  const catalog = new StoryDemoCatalog(async () => jsonResponse(next));
  const first = await catalog.refreshIndex();
  next = index();
  next.stories.push({ ...entry });
  await assert.rejects(catalog.refreshIndex(), /duplicate slug/);
  assert.equal(catalog.index, first);
  next = { ...index(), schemaVersion: 2 };
  await assert.rejects(catalog.refreshIndex(), /schemaVersion/);
  assert.equal(catalog.index, first);
});

test('index validation rejects malformed entries as a whole', () => {
  const invalid = [
    { slug: 'bad/slug' }, { slug: 'a'.repeat(81) }, { title: '  ' },
    { frameCount: 0 }, { sizeBytes: -1 }, { publishedAt: 'not-a-date' },
    { publishedAt: '2026-02-30T00:00:00Z' },
    { publishedAt: '2026-09-30T00:00:00' },
    { credit: '' },
  ];
  for (const changes of invalid) {
    const candidate = index();
    Object.assign(candidate.stories[0], changes);
    assert.throws(() => StoryDemoCatalog.validateIndex(candidate));
  }
  const tooMany = index();
  tooMany.stories = Array.from({ length: 201 }, (_, n) => ({ ...entry, slug: `story-${n}` }));
  assert.throws(() => StoryDemoCatalog.validateIndex(tooMany), /at most 200/);
  assert.equal(StoryDemoCatalog.validateIndex({ schemaVersion: 1, stories: [] }).stories.length, 0);
});

test('headers and actual streamed bytes enforce separate index and model caps', async () => {
  const oversizedIndex = new StoryDemoCatalog(async () => jsonResponse(index(), {
    headers: { 'Content-Length': String(StoryDemoCatalog.INDEX_MAX_BYTES + 1) },
  }));
  await assert.rejects(oversizedIndex.refreshIndex(), /byte limit/);

  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(80 * 1024));
    },
  });
  const streamedIndex = new StoryDemoCatalog(async () => new Response(stream, {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
  }));
  await assert.rejects(streamedIndex.refreshIndex(), /byte limit/);
  assert.ok(reads <= 3, 'the body stops as soon as it crosses the cap');

  const catalog = new StoryDemoCatalog(async (url) => url.endsWith('index.json')
    ? jsonResponse(index())
    : jsonResponse(model(), { headers: { 'Content-Length': String(StoryFileLoader.MAX_BYTES + 1) } }));
  await catalog.refreshIndex();
  await assert.rejects(catalog.fetchStory(entry.slug), /byte limit/);

  let modelReads = 0;
  let modelCancelled = false;
  const streamedModel = new StoryDemoCatalog(async (url) => url.endsWith('index.json')
    ? jsonResponse(index())
    : new Response(new ReadableStream({
      pull(controller) {
        modelReads++;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() { modelCancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } }));
  await streamedModel.refreshIndex();
  await assert.rejects(streamedModel.fetchStory(entry.slug), /byte limit/);
  assert.equal(modelCancelled, true, 'an oversized model stream is cancelled');
  assert.ok(modelReads <= 28, 'the model body stops near the first oversized chunk');
});

test('HTTP, content type, JSON, and drawable preflight errors reject before loading a model', async () => {
  const responses = [
    new Response('missing', { status: 404, headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    jsonResponse({ layers: [] }),
  ];
  const catalog = new StoryDemoCatalog(async (url) => url.endsWith('index.json')
    ? jsonResponse(index()) : responses.shift());
  await catalog.refreshIndex();
  await assert.rejects(catalog.fetchStory(entry.slug), /HTTP 404/);
  await assert.rejects(catalog.fetchStory(entry.slug), /JSON content type/);
  await assert.rejects(catalog.fetchStory(entry.slug), /valid JSON/);
  await assert.rejects(catalog.fetchStory(entry.slug), /No supported visible strokes/);
});

test('shared summary handles many drawable tiles without a spread argument limit', () => {
  const many = model();
  many.layers[0].tiles = Array.from({ length: 150000 }, (_, x) =>
    ({ x, y: x === 0 ? 0 : -x, c: '#f00', v: 1 }));
  const summary = StoryFileLoader.summarize(many);
  assert.equal(summary.drawableItems, 150000);
  assert.deepEqual(summary.bounds, { left: 0, right: 149999, top: -149999, bottom: 0 });
});
