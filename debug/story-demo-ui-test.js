'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const StoryDemoCatalog = require('../app/story-demo-catalog');
require('./browser-lock').acquireBrowserLock('Story demo UI');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});

const slugs = ['polygon', 'polyline', 'hibrid'].map((shape) => `story-8-frames-${shape}`);
const index = { schemaVersion: 1, generatedAt: '2026-09-30T00:00:00Z', stories: slugs.map((slug) => ({
  slug, title: `Story Rombs (${slug.split('-').at(-1)})`, frameCount: 8,
  sizeBytes: 4095000, credit: 'Tilecraft fixtures', publishedAt: '2026-09-30T00:00:00Z',
})) };
const model = { frames: Array.from({ length: 8 }, (_, n) => ({ id: n + 1 })), layers: [
  { visible: true, tileShape: 'polygon', polygonSize: 5, gridSize: 10, opacity: 100,
    tiles: Array.from({ length: 80 }, (_, n) => ({ x: 20 + n % 10 * 10, y: 20 + Math.floor(n / 10) * 10,
      c: '#ff0000', f: Math.floor(n / 10) + 1, g: n + 1, s: 2 })) },
] };

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    const errors = [];
    let indexRequests = 0;
    let modelRequests = 0;
    let failIndex = false;
    let failModel = true;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://cdn.storytilecraft.cc/fluid-demo/**', async (route) => {
      const url = route.request().url();
      const isIndex = url.endsWith('/index.json');
      if (isIndex) indexRequests++;
      else modelRequests++;
      if ((isIndex && failIndex) || (!isIndex && failModel)) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(isIndex ? index : model) });
      }
    });
    const base = `http://127.0.0.1:${server.address().port}/index.html?debug=none`;
    await page.goto(base);
    await page.waitForFunction(() => window.__painter?.storyTools);
    await page.click('#panel-extension-toggle');
    await page.waitForFunction(() => document.querySelectorAll('#story-demo-select option').length === 3);
    assert.equal(indexRequests, 1, 'first Demo entry fetches the index once');
    assert.deepEqual(await page.locator('.panel-extension-tabs button:visible').allTextContents(),
      ['Demo', 'File', 'Player', 'State']);
    assert.deepEqual(await page.locator('#story-demo-select option').evaluateAll((options) => options.map((option) => option.value)), slugs);
    await page.selectOption('#story-demo-select', slugs[1]);
    assert.equal(modelRequests, 0, 'choosing a slug does not load the model');
    assert.match(await page.locator('#story-demo-meta').textContent(), /8 frames/);

    failIndex = true;
    await page.click('#story-demo-refresh');
    await page.waitForFunction(() => document.querySelector('#story-demo-status').textContent.includes('Could not update'));
    assert.equal(await page.locator('#story-demo-select option').count(), 3, 'failed refresh retains options');
    assert.equal(await page.locator('#story-demo-select').inputValue(), slugs[1]);

    await page.click('#story-demo-run');
    await page.waitForFunction(() => document.querySelector('#story-demo-status').textContent.includes('Could not run'));
    assert.equal(await page.locator('#story-demo-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => window.__painter.storyPlaybackController.model), null,
      'failed Run leaves the previous Player model alone');
    assert.equal(await page.locator('#story-demo-run').isEnabled(), true);

    failModel = false;
    await page.click('#story-demo-run');
    await page.waitForFunction(() => document.querySelector('#story-player-tab').getAttribute('aria-selected') === 'true');
    await page.waitForFunction(() => ['playing', 'completed'].includes(window.__painter.storyPlaybackController.state));
    assert.equal(modelRequests, 2);
    assert.equal(await page.evaluate(() => window.__painter.storyPlaybackController.modelSummary.framesTotal), 8);
    assert.equal(await page.evaluate(() => window.__painter.storyPlaybackController.modelSummary.slug), slugs[1]);
    assert.equal(await page.locator('#story-player-slug').textContent(), slugs[1]);
    assert.match(await page.locator('#story-player-status').textContent(), /Painting story|Playback completed/);
    assert.deepEqual(errors, []);

    for (const mode of ['empty', 'preset&uiPreset=draw-min', 'features&uiFeatures=player']) {
      const before = indexRequests;
      await page.goto(`${base}&uiMode=${mode}`);
      await page.waitForFunction(() => window.__painter?.storyTools);
      assert.equal(await page.locator('#story-demo-tab').isVisible(), false);
      assert.equal(indexRequests, before, `${mode} does not fetch the Demo index`);
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/debug/story-demo-ui-probe.html`);
    const probe = page.frameLocator('#app');
    await probe.locator('#panel-extension-toggle').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelectorAll('#story-demo-select option').length === 3);
    assert.equal(await probe.locator('#story-demo-select option').count(), 3,
      'the manual probe exposes the same three controlled demos');
    assert.match(await page.locator('#requests').textContent(), /1 index · 0 model requests/);
    await page.locator('#fail-model').check();
    await probe.locator('#story-demo-run').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelector('#story-demo-status')?.textContent.includes('Could not run'));
    assert.equal(await probe.locator('#story-demo-tab').getAttribute('aria-selected'), 'true');
    await page.locator('#fail-model').uncheck();
    await probe.locator('#story-demo-run').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelector('#story-player-tab')?.getAttribute('aria-selected') === 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    const tabsFit = await probe.locator('.panel-extension-tabs').evaluate((tabs) => {
      const bounds = tabs.getBoundingClientRect();
      return [...tabs.querySelectorAll('button')].every((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.width > 40;
      });
    });
    assert.equal(tabsFit, true, 'four tabs fit in the narrow layout');
    await page.waitForFunction(() => {
      const frame = document.getElementById('app').contentWindow;
      const bounds = frame.document.querySelector('#panel-extension').getBoundingClientRect();
      return bounds.top >= 7 && bounds.bottom <= frame.innerHeight - 7;
    });
    await page.locator('#reload').click();
    await probe.locator('#panel-extension-toggle').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelectorAll('#story-demo-select option').length === 3);
    await page.waitForFunction(() => {
      const frame = document.getElementById('app').contentWindow;
      const bounds = frame.document.querySelector('#panel-extension').getBoundingClientRect();
      return bounds.top >= 7 && bounds.bottom <= frame.innerHeight - 7;
    });
    await probe.locator('#story-demo-run').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow.__painter?.storyPlaybackController.state === 'completed');
    await probe.locator('#story-keep-partial').click();
    await probe.locator('#story-speed').selectOption('0.25');
    await probe.locator('#story-demo-tab').click();
    await probe.locator('#story-demo-run').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow.__painter?.storyPlaybackController.state === 'playing');
    await probe.locator('#story-play-pause').click();
    assert.equal(await probe.locator('#story-player-status').textContent(), 'Playback paused.');
    await probe.locator('#story-play-pause').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow.__painter?.storyPlaybackController.state === 'playing');
    await probe.locator('#story-stop').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow.__painter?.storyPlaybackController.state === 'stop-decision');
    await probe.locator('#story-restore-baseline').click();
    assert.equal(await probe.locator('#story-player-status').textContent(), 'Ready.');
    await page.evaluate(() => {
      const controller = document.getElementById('app').contentWindow.__painter.storyPlaybackController;
      controller.__originalCompilePlan = controller._compilePlan;
      controller._compilePlan = () => { throw new Error('Controlled start failure'); };
    });
    await probe.locator('#story-demo-tab').click();
    await probe.locator('#story-demo-run').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelector('#story-player-status')?.textContent.includes('Controlled start failure'));
    assert.equal(await page.evaluate(() => document.getElementById('app').contentWindow.__painter.storyPlaybackController.state), 'ready',
      'a start failure leaves the validated model available for Play');
    await page.evaluate(() => {
      const controller = document.getElementById('app').contentWindow.__painter.storyPlaybackController;
      controller._compilePlan = controller.__originalCompilePlan;
    });
    await probe.locator('#story-play-pause').click();
    await page.waitForFunction(() => document.getElementById('app').contentWindow.__painter?.storyPlaybackController.state === 'playing');
    await page.locator('#fail-index').check();
    await page.locator('#reload').click();
    await probe.locator('#panel-extension-toggle').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelector('#story-demo-refresh')?.textContent === 'Retry');
    assert.equal(await probe.locator('#story-demo-run').isEnabled(), false);
    assert.equal(await probe.locator('#story-demo-select option').count(), 0);
    await page.locator('#fail-index').uncheck();
    await probe.locator('#story-demo-refresh').click();
    await page.waitForFunction(() => document.getElementById('app').contentDocument?.querySelectorAll('#story-demo-select option').length === 3);

    const fallbackPage = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    let failedCdnRequests = 0;
    const fallbackRequests = [];
    await fallbackPage.route('https://cdn.storytilecraft.cc/fluid-demo/**', async (route) => {
      failedCdnRequests++;
      await route.abort('failed');
    });
    await fallbackPage.route('https://pub-17dfba1e4d9148e7bcd3547a717794f9.r2.dev/fluid-demo/**', async (route) => {
      const url = route.request().url();
      fallbackRequests.push(url);
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(url.endsWith('/index.json') ? index : model) });
    });
    await fallbackPage.goto(base);
    await fallbackPage.waitForFunction(() => window.__painter?.storyTools);
    await fallbackPage.click('#panel-extension-toggle');
    await fallbackPage.waitForFunction(() => document.querySelectorAll('#story-demo-select option').length === 3);
    await fallbackPage.selectOption('#story-demo-select', slugs[2]);
    await fallbackPage.click('#story-demo-run');
    await fallbackPage.waitForFunction(() => document.querySelector('#story-player-tab').getAttribute('aria-selected') === 'true');
    assert.equal(await fallbackPage.locator('#story-player-slug').textContent(), slugs[2]);
    assert.equal(failedCdnRequests, 2);
    assert.deepEqual(fallbackRequests, [
      `${StoryDemoCatalog.FALLBACK_URL}index.json`,
      `${StoryDemoCatalog.FALLBACK_URL}${slugs[2]}.json`,
    ]);
    await fallbackPage.close();
    console.log('Story demo UI browser: PASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
