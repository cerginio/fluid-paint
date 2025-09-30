var InteractionMode = {
    NONE: 0,
    PAINTING: 1,
    RESIZING: 2,
    PANNING: 3
};

var ResizingSide = {
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

var ColorModel = {
    RYB: 0,
    RGB: 1
};


var QUALITIES = [
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

var INITIAL_QUALITY = 1;


var INITIAL_PADDING = 100;
var MIN_PAINTING_WIDTH = 300;
var MAX_PAINTING_WIDTH = 4096; //this is further constrained by the maximum texture size

//brush parameters
var MAX_BRISTLE_COUNT = 100;
var MIN_BRISTLE_COUNT = 10;
var MIN_BRUSH_SCALE = 5;
var MAX_BRUSH_SCALE = 75;
var BRUSH_HEIGHT = 2.0; //how high the brush is over the canvas - this is scaled with the brushScale
var Z_THRESHOLD = 0.13333; //this is scaled with the brushScale


//splatting parameters
var SPLAT_VELOCITY_SCALE = 0.14;
var SPLAT_RADIUS = 0.05;

//for thin brush (fewest bristles)
var THIN_MIN_ALPHA = 0.002;
var THIN_MAX_ALPHA = 0.08;

//for thick brush (most bristles)
var THICK_MIN_ALPHA = 0.002;
var THICK_MAX_ALPHA = 0.025;


//panel is aligned with the top left
var PANEL_WIDTH = 300;
var PANEL_HEIGHT = 580;
var PANEL_BLUR_SAMPLES = 13;
var PANEL_BLUR_STRIDE = 8;

var COLOR_PICKER_LEFT = 20;
var COLOR_PICKER_TOP = 523;

var RESIZING_RADIUS = 20;
var RESIZING_FEATHER_SIZE = 8; //in pixels 

//box shadow parameters
var BOX_SHADOW_SIGMA = 5.0;
var BOX_SHADOW_WIDTH = 10.0;
var PAINTING_SHADOW_ALPHA = 0.5;
var PANEL_SHADOW_ALPHA = 1.0;

//rendering parameters
var BACKGROUND_GRAY = 0.7;
var NORMAL_SCALE = 7.0;
var ROUGHNESS = 0.075;
var F0 = 0.05;
var SPECULAR_SCALE = 0.5;
var DIFFUSE_SCALE = 0.15;
var LIGHT_DIRECTION = [0, 1, 1];


var HISTORY_SIZE = 4; //number of snapshots we store - this should be number of reversible actions + 1


function pascalRow(n) {
    var line = [1];
    for (var k = 0; k < n; ++k) {
        line.push(line[k] * (n - k) / (k + 1));
    }
    return line;
}

//width should be an odd number
function makeBlurShader(width) {
    var coefficients = pascalRow(width - 1 + 2);

    //take the 1s off the ends
    coefficients.shift();
    coefficients.pop();

    var normalizationFactor = 0;
    for (var i = 0; i < coefficients.length; ++i) {
        normalizationFactor += coefficients[i];
    }

    var shader = [
        'precision highp float;',

        'uniform sampler2D u_input;',

        'uniform vec2 u_step;',
        'uniform vec2 u_resolution;',

        'void main () {',
        'vec4 total = vec4(0.0);',

        'vec2 coordinates = gl_FragCoord.xy / u_resolution;',
        'vec2 delta = u_step / u_resolution;',
    ].join('\n');

    shader += '\n';

    for (var i = 0; i < width; ++i) {
        var offset = i - (width - 1) / 2;

        shader += 'total += texture2D(u_input, coordinates + delta * ' + offset.toFixed(1) + ') * ' + coefficients[i].toFixed(1) + '; \n';
    }

    shader += 'gl_FragColor = total / ' + normalizationFactor.toFixed(1) + ';\n }';

    return shader;
}


function hsvToRyb(h, s, v) {
    h = h % 1;

    var c = v * s,
        hDash = h * 6;

    var x = c * (1 - Math.abs(hDash % 2 - 1));

    var mod = Math.floor(hDash);

    var r = [c, x, 0, 0, x, c][mod],
        g = [x, c, c, x, 0, 0][mod],
        b = [0, 0, x, c, c, x][mod];

    var m = v - c;

    r += m;
    g += m;
    b += m;

    return [r, g, b];
}

function makeOrthographicMatrix(matrix, left, right, bottom, top, near, far) {
    matrix[0] = 2 / (right - left);
    matrix[1] = 0;
    matrix[2] = 0;
    matrix[3] = 0;
    matrix[4] = 0;
    matrix[5] = 2 / (top - bottom);
    matrix[6] = 0;
    matrix[7] = 0;
    matrix[8] = 0;
    matrix[9] = 0;
    matrix[10] = -2 / (far - near);
    matrix[11] = 0;
    matrix[12] = -(right + left) / (right - left);
    matrix[13] = -(top + bottom) / (top - bottom);
    matrix[14] = -(far + near) / (far - near);
    matrix[15] = 1;

    return matrix;
}

function mix(a, b, t) {
    return (1.0 - t) * a + t * b;
}

//the texture is always updated to be (paintingWidth x paintingHeight) x resolutionScale
function Snapshot(texture, paintingWidth, paintingHeight, resolutionScale) {
    this.texture = texture;
    this.paintingWidth = paintingWidth;
    this.paintingHeight = paintingHeight;
    this.resolutionScale = resolutionScale;
}

// Keep Snapshot helpers prototype-based
Snapshot.prototype.getTextureWidth = function () {
    return Math.ceil(this.paintingWidth * this.resolutionScale);
};
Snapshot.prototype.getTextureHeight = function () {
    return Math.ceil(this.paintingHeight * this.resolutionScale);
};


function cursorForResizingSide(side) {
    if (side === ResizingSide.LEFT || side === ResizingSide.RIGHT) {
        return 'ew-resize';
    } else if (side === ResizingSide.BOTTOM || side === ResizingSide.TOP) {
        return 'ns-resize';
    } else if (side === ResizingSide.TOP_LEFT) {
        return 'nw-resize';
    } else if (side === ResizingSide.TOP_RIGHT) {
        return 'ne-resize';
    } else if (side === ResizingSide.BOTTOM_LEFT) {
        return 'sw-resize';
    } else if (side === ResizingSide.BOTTOM_RIGHT) {
        return 'se-resize';
    }
}

const shaderFiles = [
    'shaders/splat.vert', 'shaders/splat.frag',
    'shaders/fullscreen.vert',
    'shaders/advect.frag',
    'shaders/divergence.frag',
    'shaders/jacobi.frag',
    'shaders/subtract.frag',
    'shaders/resize.frag',

    'shaders/project.frag',
    'shaders/distanceconstraint.frag',
    'shaders/planeconstraint.frag',
    'shaders/bendingconstraint.frag',
    'shaders/setbristles.frag',
    'shaders/updatevelocity.frag',

    'shaders/brush.vert', 'shaders/brush.frag',
    'shaders/painting.vert', 'shaders/painting.frag',
    'shaders/picker.vert', 'shaders/picker.frag',
    'shaders/panel.frag',
    'shaders/output.frag',
    'shaders/shadow.frag',
]

