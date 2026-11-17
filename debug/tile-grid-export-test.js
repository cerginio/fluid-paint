'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startProductionServer } = require('./pwa-sw-harness');
require('./browser-lock').acquireBrowserLock('tile grid PNG export');

(async () => {
    const server = await startProductionServer();
    let browser;
    try {
        browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
        for (const webgl of [1, 2]) {
            const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${server.base}/?webgl=${webgl}&debug=none&diag=0&seed=41`);
            await page.waitForFunction(() => window.__painter?.engine);
            assert.equal(await page.locator('#canvas-cell canvas').count(), 1);
            await page.keyboard.press('g');
            assert.equal(await page.evaluate(() => window.__painter.tileGrid.mode), 'square');
            assert.equal(await page.locator('#canvas-cell canvas').count(), 2);
            const initialSize = await page.evaluate(() => window.__painter.tileGrid.cellSize(window.__painter.paintingRectangle.height));
            await page.keyboard.press('Equal');
            assert.equal(await page.evaluate(() => window.__painter.tileGrid.cellSize(window.__painter.paintingRectangle.height)), initialSize + 2);
            await page.keyboard.press('Minus');
            await page.keyboard.press('g');
            assert.equal(await page.evaluate(() => window.__painter.tileGrid.mode), 'hex');
            await page.keyboard.press('g');
            assert.equal(await page.locator('#canvas-cell canvas').count(), 1);
            const result = await page.evaluate(async () => {
                const p = window.__painter;
                const width = 240, height = 160;
                p.paintingRectangle.width = width;
                p.paintingRectangle.height = height;
                p.engine.resizePainting(p.getPaintingResolutionWidth(), p.getPaintingResolutionHeight(), 0, 0);
                const background = document.createElement('canvas');
                background.width = width; background.height = height;
                const ctx = background.getContext('2d');
                ctx.fillStyle = '#dc283c'; ctx.fillRect(0, 0, width, height / 2);
                ctx.fillStyle = '#285adc'; ctx.fillRect(0, height / 2, width, height / 2);
                p.engine.setBackgroundImage(background);
                const decode = async () => {
                    const blob = await p.exportPngBlob();
                    const bitmap = await createImageBitmap(blob);
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width; canvas.height = bitmap.height;
                    const context = canvas.getContext('2d');
                    context.drawImage(bitmap, 0, 0); bitmap.close();
                    return { width: canvas.width, height: canvas.height,
                        pixels: context.getImageData(0, 0, width, height).data };
                };
                const original = await decode();
                const cases = [];
                for (const mode of ['square', 'hex']) {
                    p.tileGrid.mode = mode;
                    p.tileGrid.resize(2, height);
                    const saved = await decode();
                    const size = p.tileGrid.cellSize(height);
                    const pixel = (image, x, y) => Array.from(image.pixels.slice((Math.floor(y) * width + Math.floor(x)) * 4,
                        (Math.floor(y) * width + Math.floor(x)) * 4 + 4));
                    const center = mode === 'square' ? [size / 2, size / 2] : [Math.sqrt(3) * size / 4, size / 2];
                    const boundary = mode === 'square' ? [size, size / 2] : [Math.sqrt(3) * size / 2, size / 2];
                    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
                    p.viewport.viewScale = 1.7;
                    p.viewport.viewOffsetX += 100;
                    p.viewport.presentationRotation = 1;
                    const transformed = await decode();
                    cases.push({ mode, width: saved.width, height: saved.height,
                        center: pixel(saved, ...center), originalCenter: pixel(original, ...center),
                        boundaryAlpha: pixel(saved, ...boundary)[3],
                        transparentPixels: saved.pixels.filter((v, i) => i % 4 === 3 && v === 0).length,
                        viewIndependent: same(saved.pixels, transformed.pixels) });
                    p.tileGrid.sizeAdjustment = 0;
                }
                p.tileGrid.mode = 'off';
                const restored = await decode();
                return { cases, unchanged: original.pixels.every((v, i) => v === restored.pixels[i]), operations: p._updateOperations };
            });
            for (const entry of result.cases) {
                assert.equal(entry.width, 240); assert.equal(entry.height, 160);
                assert.equal(entry.center[3], 255);
                assert.deepEqual(entry.center, entry.originalCenter, 'interior color/orientation preserved; no guide strokes');
                assert.equal(entry.boundaryAlpha, 0);
                assert.ok(entry.transparentPixels > 0);
                assert.equal(entry.viewIndependent, true);
            }
            assert.equal(result.unchanged, true, 'mask never changes the painting or off-mode export');
            assert.equal(result.operations, 0);
            assert.deepEqual(errors, []);
            console.log(`PASS WebGL${webgl}: square/hex PNG alpha, colors, resized cells, pan/zoom/rotation, original preserved`);
            await page.close();
        }
    } finally {
        if (browser) await browser.close();
        await server.stop();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
