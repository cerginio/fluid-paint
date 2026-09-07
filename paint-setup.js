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
    // At this resolution the app holds 7 simulator buffers plus HISTORY_SIZE
    // undo snapshots -- 22 float RGBA textures in all, at 16 bytes a texel.
    // The engine owns that arithmetic now; see
    // FluidEngine.estimateRenderTargetBytes(). A 1280x800 window at ratio 2 gives a 2520x1560
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

// The render-target budget arithmetic moved into the engine in Phase 5 --
// BYTES_PER_TEXEL and the count of resolution-sized simulator targets are
// facts about the simulation, and the app had to read simulation.js to know
// the second one. See FluidEngine.maxResolutionScaleForBudget().

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

// A two-finger gesture emits BOTH pan2 and pinch; the dispatcher only withholds
// a pinch whose scale is exactly 1, so span jitter makes a pure drag report a
// scale a hair off 1. Below this much scale change a two-finger gesture counts
// as a drag, not a resize. See Paint.onGesturePinch().
const PINCH_SCALE_DEADZONE = 0.02;

// Floor for pen-pressure brush scaling (Phase 6). A pen that reports 0 -- which
// some report on the first sample of a stroke -- would otherwise open the
// stroke with a zero-height brush and paint nothing at the very moment of
// contact. Only pens are scaled at all; see Paint._pressureScale().
const MIN_PRESSURE_SCALE = 0.15;


//splatting parameters
const SPLAT_VELOCITY_SCALE = 0.14;
const SPLAT_RADIUS = 0.05;

//for thin brush (fewest bristles)
const THIN_MIN_ALPHA = 0.002;
const THIN_MAX_ALPHA = 0.08;

//for thick brush (most bristles)
const THICK_MIN_ALPHA = 0.002;
const THICK_MAX_ALPHA = 0.025;


// PANEL_WIDTH/PANEL_HEIGHT/PANEL_BLUR_* are gone (Phase 7). The panel is a DOM
// element laid out by app/layout.css, so its size is a CSS property and there
// is nothing left here to keep in sync with it -- which is the point: two
// declarations of one dimension is how the old layout drifted.
//
// COLOR_PICKER_LEFT/TOP survive only as the fallback placement for a host with
// no #color-picker-slot in its markup. The normal path reads the slot's rect
// (Paint._positionColorPicker), so the picker follows the layout instead of
// sitting at a fixed offset from a window-sized canvas.
const COLOR_PICKER_LEFT = 20;
const COLOR_PICKER_TOP = 523;

const RESIZING_RADIUS_CSS = 20;   // CSS pixels -- convert with viewport.cssLengthToScreen

//box shadow parameters
const BOX_SHADOW_SIGMA = 5.0;
const BOX_SHADOW_WIDTH = 10.0;
// The PAINTING's shadow, still drawn by GL: it sits on the canvas background
// under the painting, which is presentation of the painting rather than chrome.
// PANEL_SHADOW_ALPHA went with the panel -- that shadow is a CSS box-shadow.
const PAINTING_SHADOW_ALPHA = 0.5;

// The painting's rendering parameters -- background grey, normal scale,
// roughness, F0, specular/diffuse scale, light direction and the resize
// feather -- moved into fluid-engine/renderer.js in Phase 4. They describe how
// the engine's wet paint reflects light, so they belong with the draw call that
// uses them, not with the app's layout numbers above.


const HISTORY_SIZE = 15; //number of snapshots we store - this should be number of reversible actions + 1



