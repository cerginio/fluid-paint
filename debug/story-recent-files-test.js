'use strict';

/*
 * The File tab's recent-files list, exercised in a real browser because its
 * whole point is IndexedDB persistence across a reload -- a mock would only
 * prove the mock works.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Story recent files');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
  '.html': 'text/html', '.vert': 'text/plain', '.frag': 'text/plain', '.png': 'image/png' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});

const story = (name) => JSON.stringify({
  layers: [{ visible: true, tileShape: 'polyline', gridSize: 4,
    tiles: [{ x: 0, y: 0, c: '#ff0000', g: 1, s: 1, b: 2 },
      { x: 40, y: 0, c: '#ff0000', g: 1, s: 1 }] }],
  _name: name,
});

const openFile = async (page, name) => {
  await page.evaluate(async ({ text, fileName }) => {
    const tools = window.__painter.storyTools;
    await tools._load(new File([text], fileName, { type: 'application/json' }));
  }, { text: story(name), fileName: name });
  await page.waitForTimeout(150);
};

const listNames = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#story-recent-list .story-recent-name')].map((n) => n.textContent));

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
  const url = `http://127.0.0.1:${server.address().port}/index.html?debug=none`;
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__painter && window.__painter.storyTools);

    // Empty to begin with: the card stays out of the way until there is history.
    assert.equal(await page.evaluate(() => document.getElementById('story-recent-card').hidden), true,
      'the card is hidden while nothing has been opened');

    await openFile(page, 'first.json');
    assert.deepEqual(await listNames(page), ['first.json'], 'an opened story is remembered');
    assert.equal(await page.evaluate(() => document.getElementById('story-recent-card').hidden), false,
      'and the card appears');

    // Newest first, and capped at three.
    for (const name of ['second.json', 'third.json', 'fourth.json']) await openFile(page, name);
    assert.deepEqual(await listNames(page),
      ['fourth.json', 'third.json', 'second.json'],
      'the list keeps the three newest, newest first');

    // Reopening an older file promotes it instead of duplicating it.
    await openFile(page, 'second.json');
    assert.deepEqual(await listNames(page), ['second.json', 'fourth.json', 'third.json'],
      'reopening promotes rather than duplicates');

    // The actual feature: one tap reopens the story.
    await page.evaluate(() => window.__painter.storyPlaybackController.removeFile());
    await page.waitForTimeout(100);
    // Loading a story switches to the Player tab, so come back to File first:
    // the row has to be genuinely visible for a tap to reach it.
    await page.evaluate(() => {
      // The panel must be OPEN, not merely on the right tab: a collapsed
      // panel lays its pages out at zero height and no tap can land.
      window.__painter.toolPanel.setExtensionOpen(true);
      window.__painter.toolPanel.selectExtensionTab('file', true);
    });
    await page.waitForTimeout(100);
    await page.click('#story-recent-list li:nth-child(1) button');
    await page.waitForTimeout(300);
    // The newest row is second.json, so that is the story that must come back.
    assert.equal(await page.evaluate(() => {
      const summary = window.__painter.storyPlaybackController.modelSummary;
      return summary && summary.fileName;
    }), 'second.json', 'one tap on a recent row reloads exactly that story');

    // Survives a reload: the point of storing it at all.
    await page.reload();
    await page.waitForFunction(() => window.__painter && window.__painter.storyTools);
    await page.waitForTimeout(250);
    assert.deepEqual(await listNames(page), ['second.json', 'fourth.json', 'third.json'],
      'the list survives a reload');

    // Clearing empties it and hides the card again.
    await page.evaluate(() => {
      // The panel must be OPEN, not merely on the right tab: a collapsed
      // panel lays its pages out at zero height and no tap can land.
      window.__painter.toolPanel.setExtensionOpen(true);
      window.__painter.toolPanel.selectExtensionTab('file', true);
    });
    await page.waitForTimeout(100);
    await page.click('#story-recent-clear');
    await page.waitForTimeout(200);
    assert.deepEqual(await listNames(page), [], 'Clear empties the list');
    assert.equal(await page.evaluate(() => document.getElementById('story-recent-card').hidden), true,
      'and hides the card');

    assert.deepEqual(errors, [], 'no page errors');
    console.log('story recent files: PASS (3 newest, promotion, one-tap reopen, survives reload)');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
