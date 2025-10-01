// ES6 class version of BrushViewer

// --- small matrix helpers (local) ---
function makePerspectiveMatrix(out, fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);

    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2 * far * near) * nf; out[15] = 0;
    return out;
}

function makeIdentityMatrix(m) {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
}

// out = B * A
function premultiplyMatrix(out, A, B) {
    let b0 = B[0], b4 = B[4], b8 = B[8], b12 = B[12],
        b1 = B[1], b5 = B[5], b9 = B[9], b13 = B[13],
        b2 = B[2], b6 = B[6], b10 = B[10], b14 = B[14],
        b3 = B[3], b7 = B[7], b11 = B[11], b15 = B[15];

    let aX = A[0], aY = A[1], aZ = A[2], aW = A[3];
    out[0] = b0 * aX + b4 * aY + b8 * aZ + b12 * aW;
    out[1] = b1 * aX + b5 * aY + b9 * aZ + b13 * aW;
    out[2] = b2 * aX + b6 * aY + b10 * aZ + b14 * aW;
    out[3] = b3 * aX + b7 * aY + b11 * aZ + b15 * aW;

    aX = A[4]; aY = A[5]; aZ = A[6]; aW = A[7];
    out[4] = b0 * aX + b4 * aY + b8 * aZ + b12 * aW;
    out[5] = b1 * aX + b5 * aY + b9 * aZ + b13 * aW;
    out[6] = b2 * aX + b6 * aY + b10 * aZ + b14 * aW;
    out[7] = b3 * aX + b7 * aY + b11 * aZ + b15 * aW;

    aX = A[8]; aY = A[9]; aZ = A[10]; aW = A[11];
    out[8] = b0 * aX + b4 * aY + b8 * aZ + b12 * aW;
    out[9] = b1 * aX + b5 * aY + b9 * aZ + b13 * aW;
    out[10] = b2 * aX + b6 * aY + b10 * aZ + b14 * aW;
    out[11] = b3 * aX + b7 * aY + b11 * aZ + b15 * aW;

    aX = A[12]; aY = A[13]; aZ = A[14]; aW = A[15];
    out[12] = b0 * aX + b4 * aY + b8 * aZ + b12 * aW;
    out[13] = b1 * aX + b5 * aY + b9 * aZ + b13 * aW;
    out[14] = b2 * aX + b6 * aY + b10 * aZ + b14 * aW;
    out[15] = b3 * aX + b7 * aY + b11 * aZ + b15 * aW;

    return out;
}

function makeXRotationMatrix(m, angle) {
    m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
    m[4] = 0; m[5] = Math.cos(angle); m[6] = Math.sin(angle); m[7] = 0;
    m[8] = 0; m[9] = -Math.sin(angle); m[10] = Math.cos(angle); m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
}

function makeYRotationMatrix(m, angle) {
    m[0] = Math.cos(angle); m[1] = 0; m[2] = -Math.sin(angle); m[3] = 0;
    m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
    m[8] = Math.sin(angle); m[9] = 0; m[10] = Math.cos(angle); m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
    return m;
}

// --- class ---
class BrushViewer {
    /**
     * @param {*} wgl
     * @param {*} brushProgram
     * @param {number} left
     * @param {number} bottom
     * @param {number} width
     * @param {number} height
     */
    constructor(wgl, brushProgram, left, bottom, width, height) {
        this.wgl = wgl;
        this.brushProgram = brushProgram;

        this.left = left;
        this.bottom = bottom;
        this.width = width;
        this.height = height;

        this.closeupProjectionMatrix = makePerspectiveMatrix(
            new Float32Array(16),
            Math.PI / 2.0,
            this.width / this.height,
            1.0,
            10000
        );
    }

    draw(brushX, brushY, brush, color) {
        const wgl = this.wgl;

        const xRotationMatrix = new Float32Array(16);
        const yRotationMatrix = new Float32Array(16);
        const distanceTranslationMatrix = makeIdentityMatrix(new Float32Array(16));
        const orbitTranslationMatrix = makeIdentityMatrix(new Float32Array(16));

        const viewMatrix = makeIdentityMatrix(new Float32Array(16));

        const elevation = -Math.PI / 2;
        const azimuth = 0.0;
        const distance = 120.0;
        const orbitPoint = [brushX, brushY, 60.0];

        makeXRotationMatrix(xRotationMatrix, elevation);
        makeYRotationMatrix(yRotationMatrix, azimuth);
        distanceTranslationMatrix[14] = -distance;
        orbitTranslationMatrix[12] = -orbitPoint[0];
        orbitTranslationMatrix[13] = -orbitPoint[1];
        orbitTranslationMatrix[14] = -orbitPoint[2];

        premultiplyMatrix(viewMatrix, viewMatrix, orbitTranslationMatrix);
        premultiplyMatrix(viewMatrix, viewMatrix, yRotationMatrix);
        premultiplyMatrix(viewMatrix, viewMatrix, xRotationMatrix);
        premultiplyMatrix(viewMatrix, viewMatrix, distanceTranslationMatrix);

        const projectionViewMatrix = premultiplyMatrix(
            new Float32Array(16),
            viewMatrix,
            this.closeupProjectionMatrix
        );

        const brushDrawState = wgl
            .createDrawState()
            .bindFramebuffer(null)
            .viewport(this.left, this.bottom, this.width, this.height)
            .vertexAttribPointer(brush.brushTextureCoordinatesBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)
            .useProgram(this.brushProgram)
            .bindIndexBuffer(brush.brushIndexBuffer)
            // .uniform4f('u_color', 0, 0, 1, 1.0)
            .uniform4f('u_color', color[0], color[1], color[2], 1.0)
            .uniformMatrix4fv('u_projectionViewMatrix', false, projectionViewMatrix)
            .enable(wgl.DEPTH_TEST)
            .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, brush.positionsTexture);

        wgl.drawElements(
            brushDrawState,
            wgl.LINES,
            (brush.indexCount * brush.bristleCount) / brush.maxBristleCount,
            wgl.UNSIGNED_SHORT,
            0
        );
    }
}

// If using modules:
// export default BrushViewer;
