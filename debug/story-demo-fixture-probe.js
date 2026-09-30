'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const StoryDemoCatalog = require('../app/story-demo-catalog');

const fixtureDir = process.argv[2];
if (!fixtureDir) {
  throw new Error('Usage: node debug/story-demo-fixture-probe.js <ua-dream catalog fixture directory>');
}

const requests = [];
const catalog = new StoryDemoCatalog(async (url) => {
  if (!url.startsWith(StoryDemoCatalog.BASE_URL)) throw new Error(`Unexpected URL: ${url}`);
  const name = url.slice(StoryDemoCatalog.BASE_URL.length);
  if (!/^(?:index|story-[a-z0-9-]+)\.json$/.test(name)) throw new Error(`Unexpected file: ${name}`);
  requests.push(url);
  const file = path.join(fixtureDir, name);
  const size = fs.statSync(file).size;
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(size) },
  });
});

(async () => {
  const index = await catalog.refreshIndex();
  for (const story of index.stories) {
    const loaded = await catalog.fetchStory(story.slug);
    if (loaded.summary.framesTotal !== 8) throw new Error(`${story.slug}: expected 8 frames`);
    console.log(`${story.slug}: ${loaded.summary.framesTotal} frames, ${loaded.summary.byteSize} bytes, ${loaded.summary.drawableItems} drawable items`);
  }
  if (requests.length !== index.stories.length + 1) throw new Error('Unexpected request count.');
  console.log(`${requests.length} requests under ${StoryDemoCatalog.BASE_URL}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
