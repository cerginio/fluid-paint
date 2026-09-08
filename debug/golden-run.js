'use strict';

/*
 * Golden-image runner.
 *
 * Serves the app, drives the in-page harness through headless Chromium on both
 * the WebGL 2 and WebGL 1 paths, and compares the resulting hashes against a
 * recorded baseline.
 *
 * This is what makes "the refactor changed nothing" checkable rather than a
 * matter of opinion.
 *
 *   node debug/golden-run.js --record    write debug/golden-baseline.json
 *   node debug/golden-run.js             verify against it (non-zero exit on drift)
 *   node debug/golden-run.js --scenario colorMix
 *
 * Headless Chromium uses SwiftShader, so hashes are stable for a given
 * Playwright version but are NOT comparable to a real GPU's. The baseline is a
 * regression tripwire for refactors on this machine, not a cross-device
 * expectation -- device verification stays manual, per docs/DEVICE-VERIFICATION.md.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

// Refuse to be the second concurrent Playwright run on this machine.
// See debug/browser-lock.js for why this is enforced in code.
acquireBrowserLock('golden run');

const ROOT = process.env.GOLDEN_ROOT
  ? path.resolve(process.env.GOLDEN_ROOT)
  : path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'golden-baseline.json');
const SCENARIOS = ['basic', 'colorMix', 'wetBlend'];
// The devicePixelRatio axis. dpr1 is the historical baseline; dpr2 covers the
// path Phase 2 turned on, which dpr1 cannot see at all -- at ratio 1 the new
// code is equivalent to the old by construction, so without this axis the
// headline change of the phase would ship untested.
const DPRS = [1, 2];
const SEED = 20260907;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.frag': 'text/plain', '.vert': 'text/plain', '.png': 'image/png',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function runOne(browser, port, scenario, webglVersion, dpr) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: dpr,
  });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

  const qs = [`seed=${SEED}`, `golden=${scenario}`];
  if (process.env.GOLDEN_PROBE) await page.addInitScript(() => { window.__goldenProbe = true; });
  if (webglVersion === 1) qs.push('webgl=1');
  await page.goto(`http://127.0.0.1:${port}/index.html?${qs.join('&')}`);

  let results;
  try {
    await page.waitForFunction(() => window.__goldenDone === true, null, { timeout: 90000 });
    results = await page.evaluate(() => window.__goldenResults);
  } catch (err) {
    results = [{ scenario, error: 'timeout: ' + err.message, logs: logs.slice(-12) }];
  }
  /* GOLDEN_SHOTS=<dir> saves what each scenario actually painted. Hashes say
   * THAT something changed; only an image says whether the change is
   * acceptable, which is what re-recording a baseline requires. */
  if (process.env.GOLDEN_SHOTS && !results.some((r) => r.error)) {
    const dir = path.resolve(process.env.GOLDEN_SHOTS);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${scenario}-webgl${webglVersion}-dpr${dpr}.png`);
    await page.screenshot({ path: file });
  }

  await page.close();
  return results.map((r) => Object.assign({ webglRequested: webglVersion, dpr }, r));
}

async function main() {
  const args = process.argv.slice(2);
  const record = args.includes('--record');
  const only = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;
  const scenarios = only ? [only] : SCENARIOS;

  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // SwiftShader rasterises on the CPU, so without a cap a run takes every
      // core and freezes the desktop -- measured at 91% CPU with the mouse
      // stalling for seconds. These cap the damage:
      //   renderer-process-limit  one renderer, not one per tab
      //   max-old-space-size      the JS heap, which the readbacks can grow
      //   disable-dev-shm-usage   avoids a second copy of every framebuffer
      // Raising any of them does not make the hashes more correct, only the
      // machine less usable while they run.
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=512',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
    ],
  });

  const rows = [];
  for (const dpr of DPRS) {
   for (const webglVersion of [2, 1]) {
    for (const scenario of scenarios) {
      process.stdout.write(`  running ${scenario} on WebGL ${webglVersion} @dpr${dpr} ... `);
      const out = await runOne(browser, port, scenario, webglVersion, dpr);
      for (const r of out) {
        rows.push(r);
        if (r.error) {
          process.stdout.write(`ERROR\n    ${r.error}\n`);
        } else {
          process.stdout.write(`paint=${r.paintHash} screen=${r.screenHash}`);
          if (process.env.GOLDEN_AGGREGATE && r.aggregate) {
            const g = r.aggregate;
            process.stdout.write(
              `
      alpha=${g.totalAlpha} texels=${g.paintedTexels} ` +
              `cov=${g.coverage} meanRYB=[${g.meanRYB.join(', ')}] ` +
              `bounds=[${(g.bounds || []).join(',')}]`
            );
          }
          if (r.greenCheck) {
            process.stdout.write(`  green=${r.greenCheck} mean(R,Y,B)=[${r.greenMean}]`);
          }
          process.stdout.write('\n');
          if (r.probeGrid) {
            console.log('    probe grid (R/Y/B/A), bottom row first:');
            r.probeGrid.forEach((g) => console.log('      ' + g));
          }
        }
      }
    }
   }
  }

  await browser.close();
  server.close();

  const key = (r) => `webgl${r.webglRequested}/dpr${r.dpr}/${r.scenario}`;
  const failed = rows.filter((r) => r.error || r.greenCheck === 'FAIL');

  if (record) {
    if (failed.length) {
      console.error('\nRefusing to record a baseline with failures:');
      for (const f of failed) console.error('  ' + key(f) + ': ' + (f.error || f.greenReason));
      process.exit(1);
    }
    const baseline = {
      recorded: new Date().toISOString(),
      seed: SEED,
      note: 'headless SwiftShader; not comparable to real-GPU hashes',
      entries: Object.fromEntries(rows.map((r) => [key(r), {
        paintHash: r.paintHash, screenHash: r.screenHash,
        resolution: r.resolution, webgl: r.webgl, dpr: r.dpr, description: r.description,
      }])),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nBaseline written: ${path.relative(ROOT, BASELINE)} (${rows.length} entries)`);
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('\nNo baseline. Run:  node debug/golden-run.js --record');
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let drift = 0;
  console.log('');
  for (const r of rows) {
    const k = key(r);
    const expected = baseline.entries[k];
    if (r.error) { console.log(`  FAIL  ${k}  ${r.error}`); ++drift; continue; }
    if (r.greenCheck === 'FAIL') {
      console.log(`  FAIL  ${k}  RYB green check: ${r.greenReason} (mean ${r.greenMean})`);
      ++drift;
    }
    if (!expected) { console.log(`  NEW   ${k}  paint=${r.paintHash} screen=${r.screenHash} (not in baseline)`); continue; }
    let moved = false;
    if (expected.paintHash !== r.paintHash) {
      console.log(`  DRIFT ${k}  paint  ${expected.paintHash} -> ${r.paintHash}  (simulation changed)`);
      moved = true;
    }
    if (expected.screenHash !== r.screenHash) {
      console.log(`  DRIFT ${k}  screen ${expected.screenHash} -> ${r.screenHash}  (rendering changed)`);
      moved = true;
    }
    if (moved) ++drift; else console.log(`  ok    ${k}  paint=${r.paintHash} screen=${r.screenHash}`);
  }

  if (drift) {
    console.error(`\n${drift} check(s) failed. If the change was intended, re-record with --record.`);
    process.exit(1);
  }
  console.log('\nAll golden checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
