const InteractionMode = {
    NONE: 0,
    PAINTING: 1,
    RESIZING: 2,
    PANNING: 3
};

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


const INITIAL_PADDING = 100;
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

const RESIZING_RADIUS = 20;
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



