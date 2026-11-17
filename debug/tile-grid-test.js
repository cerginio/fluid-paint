'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class GeometryPath {
    constructor() { this.polygons = []; }
    rect(x, y, width, height) {
        this.polygons.push([[x, y], [x + width, y], [x + width, y + height], [x, y + height]]);
    }
    moveTo(x, y) { this.polygons.push([[x, y]]); }
    lineTo(x, y) { this.polygons.at(-1).push([x, y]); }
    closePath() {}
}
const TileGrid = vm.runInNewContext(fs.readFileSync(require.resolve('../app/tile-grid.js'), 'utf8') + ';TileGrid', {
    Path2D: GeometryPath,
    document: { createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) },
});
const grid = () => new TileGrid({ after() {} });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('G cycle begins disabled and returns to disabled after square and hex', () => {
    const g = grid();
    assert.equal(g.mode, 'off');
    for (const mode of ['square', 'hex', 'off']) {
        g.cycle();
        assert.equal(g.mode, mode);
        assert.equal(g.canvas.hidden, mode === 'off');
    }
});

test('square guides share boundaries and inset all four edges', () => {
    const g = grid(); g.mode = 'square';
    const outer = g.outlines(1200, 800, 0).polygons;
    const inner = g.outlines(1200, 800, g.margin).polygons;
    assert.equal(outer.length, 24);
    assert.deepEqual(outer[0][1], outer[1][0]);
    assert.deepEqual(inner[0], [[8, 8], [192, 8], [192, 192], [8, 192]]);
});

test('hex guides tessellate and each inset edge stays parallel at the intended distance', () => {
    const g = grid(); g.mode = 'hex';
    const radius = 2 * 800 / (2 + 1.5 * 7), width = Math.sqrt(3) * radius;
    const outer = g.outlines(1200, 800, 0).polygons;
    const inner = g.outlines(1200, 800, g.margin).polygons;
    near(outer[0][1][0], outer[1][5][0]);
    near(outer[0][1][1], outer[1][5][1]);
    outer.forEach((polygon, cell) => polygon.forEach((a, vertex) => {
        const b = polygon[(vertex + 1) % 6], p = inner[cell][vertex];
        const q = inner[cell][(vertex + 1) % 6];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        near(dx * (q[1] - p[1]) - dy * (q[0] - p[0]), 0);
        near(Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy), width * g.margin);
    }));
});

test('both shapes resize by 2 painting pixels and keep that size under zoom', () => {
    for (const mode of ['square', 'hex']) {
        const g = grid(); g.mode = mode;
        const initial = g.cellSize(800);
        g.resize(2, 800);
        near(g.cellSize(800), initial + 2);
        const normal = g.outlines(1200, 800, 0).polygons[0];
        const zoomed = g.outlines(2400, 1600, 0, 2).polygons[0];
        normal.forEach((point, i) => point.forEach((value, axis) => near(zoomed[i][axis], value * 2)));
        g.resize(-2, 800);
        near(g.cellSize(800), initial);
        for (let i = 0; i < 500; i++) g.resize(-2, 800);
        near(g.cellSize(800), 8);
        g.resize(2, 800);
        near(g.cellSize(800), 10);
    }
});
