'use strict';

// Two guide contours per cell; pigment remains one continuous painting.
class TileGrid {
    constructor(canvas) {
        this.source = canvas;
        this.mode = 'off';
        this.rows = 8;
        this.sizeAdjustment = 0;
        this.margin = 0.04; // inset per edge, relative to cell width
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'tile-grid-overlay';
        this.canvas.setAttribute('aria-hidden', 'true');
        this.canvas.hidden = true;
    }

    cycle() {
        const modes = ['off', 'square', 'hex'];
        this.mode = modes[(modes.indexOf(this.mode) + 1) % modes.length];
        this.canvas.hidden = this.mode === 'off';
        if (this.mode === 'off') this.canvas.remove();
        else this.source.after(this.canvas);
        this._key = null;
    }

    cellSize(paintingHeight) {
        const initial = this.mode === 'hex'
            ? 4 * paintingHeight / (2 + 1.5 * (this.rows - 1))
            : 2 * paintingHeight / this.rows;
        return Math.max(8, initial + this.sizeAdjustment);
    }

    resize(delta, paintingHeight) {
        if (this.mode === 'off') return;
        const current = this.cellSize(paintingHeight);
        this.sizeAdjustment += Math.max(8, current + delta) - current;
        this._key = null;
    }

    // Size is measured in painting pixels, so zoom never changes the 2px step.
    outlines(width, height, insetRatio, viewScale = 1) {
        const path = new Path2D();
        const size = this.cellSize(height / viewScale) * viewScale;
        if (this.mode === 'square') {
            const side = size;
            const inset = side * insetRatio;
            for (let row = 0; row < Math.ceil(height / side); row++) {
                for (let col = 0; col < Math.ceil(width / side); col++) {
                    path.rect(col * side + inset, row * side + inset,
                        side - 2 * inset, side - 2 * inset);
                }
            }
        } else if (this.mode === 'hex') {
            const radius = size / 2;
            const cellWidth = Math.sqrt(3) * radius;
            // Shrinking the radius preserves parallel edges at a constant inset.
            const innerRadius = radius * (1 - 2 * insetRatio);
            for (let row = -1; row <= Math.ceil(height / (1.5 * radius)); row++) {
                const cy = radius + row * 1.5 * radius;
                for (let col = -1; col <= Math.ceil(width / cellWidth); col++) {
                    const cx = (col + 0.5 + Math.abs(row % 2) * 0.5) * cellWidth;
                    for (let vertex = 0; vertex < 6; vertex++) {
                        const angle = -Math.PI / 2 + vertex * Math.PI / 3;
                        const x = cx + Math.cos(angle) * innerRadius;
                        const y = cy + Math.sin(angle) * innerRadius;
                        if (vertex === 0) path.moveTo(x, y);
                        else path.lineTo(x, y);
                    }
                    path.closePath();
                }
            }
        }
        return path;
    }

    maskExport(canvas, paintingWidth, paintingHeight) {
        if (this.mode === 'off') return;
        const context = canvas.getContext('2d');
        context.save();
        // Export dimensions may be rounded by the canvas; keep the same world grid.
        context.scale(canvas.width / paintingWidth, canvas.height / paintingHeight);
        context.globalCompositeOperation = 'destination-in';
        context.fillStyle = '#fff';
        context.fill(this.outlines(paintingWidth, paintingHeight, this.margin));
        context.restore();
    }

    guides(context, width, height, pixelRatio = 1, viewScale = 1) {
        if (this.mode === 'off') return;
        context.save();
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        const outer = this.outlines(width, height, 0, viewScale);
        const inner = this.outlines(width, height, this.margin, viewScale);
        // A pale halo keeps the guides readable over dark pigment as well.
        context.lineWidth = 2.5 * pixelRatio;
        context.strokeStyle = 'rgba(255,255,255,0.65)';
        context.stroke(outer);
        context.stroke(inner);
        context.lineWidth = pixelRatio;
        context.strokeStyle = 'rgba(30,41,59,0.5)';
        context.stroke(outer);
        context.setLineDash([3 * pixelRatio, 3 * pixelRatio]);
        context.strokeStyle = 'rgba(30,41,59,0.4)';
        context.stroke(inner);
        context.restore();
    }

    draw(source, rectangle, pixelRatio = 1, viewScale = 1) {
        if (this.mode === 'off') return;
        const canvas = this.canvas;
        // Copy Viewport's sizing/rotation, including presentation on mobile.
        canvas.style.cssText = source.style.cssText;
        canvas.style.pointerEvents = 'none';
        const key = [source.width, source.height, rectangle.left, rectangle.bottom,
            rectangle.width, rectangle.height, this.mode, this.rows, this.margin,
            this.sizeAdjustment, pixelRatio, viewScale].join(':');
        if (key === this._key) return;
        this._key = key;
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext('2d');
        context.translate(rectangle.left, source.height - rectangle.bottom - rectangle.height);
        this.guides(context, rectangle.width, rectangle.height, pixelRatio, viewScale);
    }
}
