'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('Tilecraft source model browser probe');

const root = process.env.TILECRAFT_REPO || path.resolve(__dirname, '../../../js-games/ua-dream');
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.extname(file) === '.js' ? 'application/javascript' : 'text/html');
    response.end(data);
  });
});

(async () => {
  let url = 'http://127.0.0.1:8080/tests/fluid-player-model-probe.html';
  let ownsServer = false;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Existing Tilecraft server returned ${response.status}`);
  } catch (_) {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    ownsServer = true;
    url = `http://127.0.0.1:${server.address().port}/tilecraft/tests/fluid-player-model-probe.html`;
  }
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.click('#run');
    assert.equal(await page.locator('#result').textContent(),
      'polygonSize=3 a=128 sa=0.523599 fit.scale=3.3');
    assert.deepEqual(errors, []);
    console.log('Tilecraft source model browser probe: PASS (triangle, alpha, rotation, fit)');
  } finally {
    await browser.close();
    if (ownsServer) await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
