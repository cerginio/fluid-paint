const InteractionMode = {
    NONE: 0,
    PAINTING: 1,
    RESIZING: 2,
    PANNING: 3
};

const PaintState = {
    showPanel: true,

    // devicePixelRatio handling, overridable from the URL so a device can be
    // checked both ways without a rebuild:
    //
    //   ?dpr=1     pin the ratio to 1 -- the pre-Phase-2 behaviour
    //   ?dpr=3     raise the clamp (the default cap is 2)
    //
    // The cap exists because the simulation is fill-rate bound and its cost
    // scales with the square of the ratio.
    pixelRatioEnabled: true,
    maxPixelRatio: 2,

    // Hard ceiling on GPU memory for the resolution-dependent render targets.
    //
    // maxPaintingWidth already clamps each DIMENSION against MAX_TEXTURE_SIZE,
    // but nothing clamped total memory -- and everything here scales with the
    // painting's AREA, so a ratio of 2 costs four times as much, not twice.
    //
    // At this resolution the app holds SIMULATION_TARGETS + HISTORY_SIZE float
    // RGBA textures: 7 simulator buffers and 15 undo snapshots, 22 in all, at
    // 16 bytes a texel. A 1280x800 window at ratio 2 gives a 2520x1560
    // painting, which is 3.93 Mtexels, so even at quality Low that is ~1.3 GB.
    // The driver answers GL_OUT_OF_MEMORY and drops the context -- a black
    // canvas, not a slow one -- which is why this is a hard limit rather than
    // something to profile later.
    //
    // When the budget binds, the simulation scale degrades (below quality Low
    // if it has to). The painting keeps the size the user asked for and the
    // undo history keeps its depth; what gives is simulation fidelity, which
    // is the one of the three that degrades gracefully.
    //
    // 1 GB is chosen so that the pre-DPR behaviour is untouched -- a 1280x800
    // window at quality High needs 712 MB and stays exactly as it was -- while
    // a ratio-2 window degrades instead of losing the context. Note this limit
    // was always reachable without DPR: a 2560x1440 window at quality High
    // asks for 2.6 GB today. DPR did not create the defect, it made it
    // reachable on an ordinary window.
    maxRenderTargetBytes: 1024 * 1024 * 1024,
};

// Float RGBA: 4 channels x 4 bytes.
const BYTES_PER_TEXEL = 16;
// Simulator render targets that scale with the painting resolution: paint,
// paintTemp, velocity, velocityTemp, divergence, pressure, pressureTemp.
const SIMULATION_TARGETS = 7;

(function parsePixelRatioOverride() {
    if (typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('dpr');
    if (raw === null) return;

    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
        console.warn('[viewport] ignoring non-numeric dpr:', raw);
        return;
    }

    if (value === 1) {
        PaintState.pixelRatioEnabled = false;
    } else {
        PaintState.maxPixelRatio = value;
    }
    console.log('[viewport] dpr override:', raw);
})();

const ResizingSide = {
    NONE: 0,
    LEFT: 1,
    RIGHT: 2,
    BOTTOM: 3,
    TOP: 4,
    TOP_LEFT: 5,
    TOP_RIGHT: 6,
    BOTTOM_LEFT: 7,
    BOTTOM_RIGHT: 8
};

const ColorModel = {
    RYB: 0,
    RGB: 1
};


const QUALITIES = [
    {
        name: 'Low',
        resolutionScale: 1.0
    },
    {
        name: 'Medium',
        resolutionScale: 1.5
    },
    {
        name: 'High',
        resolutionScale: 2.0
    }
];

const INITIAL_QUALITY = 1;


const INITIAL_PADDING = 20;
const MIN_PAINTING_WIDTH = 300;
const MAX_PAINTING_WIDTH = 4096; //this is further constrained by the maximum texture size

//brush parameters
const MAX_BRISTLE_COUNT = 100;
const MIN_BRISTLE_COUNT = 10;
const MIN_BRUSH_SCALE = 5;
const MAX_BRUSH_SCALE = 75;
const BRUSH_HEIGHT = 2.0; //how high the brush is over the canvas - this is scaled with the brushScale
const Z_THRESHOLD = 0.13333; //this is scaled with the brushScale


//splatting parameters
const SPLAT_VELOCITY_SCALE = 0.14;
const SPLAT_RADIUS = 0.05;

//for thin brush (fewest bristles)
const THIN_MIN_ALPHA = 0.002;
const THIN_MAX_ALPHA = 0.08;

//for thick brush (most bristles)
const THICK_MIN_ALPHA = 0.002;
const THICK_MAX_ALPHA = 0.025;


//panel is aligned with the top left
const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 580;
const PANEL_BLUR_SAMPLES = 13;
const PANEL_BLUR_STRIDE = 8;

const COLOR_PICKER_LEFT = 20;
const COLOR_PICKER_TOP = 523;

const RESIZING_RADIUS_CSS = 20;   // CSS pixels -- convert with viewport.cssLengthToScreen
const RESIZING_FEATHER_SIZE = 8; //in pixels 

//box shadow parameters
const BOX_SHADOW_SIGMA = 5.0;
const BOX_SHADOW_WIDTH = 10.0;
const PAINTING_SHADOW_ALPHA = 0.5;
const PANEL_SHADOW_ALPHA = 1.0;

//rendering parameters
const BACKGROUND_GRAY = 0.7;
const NORMAL_SCALE = 7.0;
const ROUGHNESS = 0.075;
const F0 = 0.05;
const SPECULAR_SCALE = 0.5;
const DIFFUSE_SCALE = 0.15;
const LIGHT_DIRECTION = [0, 1, 1];


const HISTORY_SIZE = 15; //number of snapshots we store - this should be number of reversible actions + 1



