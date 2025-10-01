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


function hexToRgba01(hex, a = 1) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return [r, g, b, a];
};


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

const CONSTANT_NAMES = [
  'ACTIVE_ATTRIBUTES',
  'ACTIVE_ATTRIBUTE_MAX_LENGTH',
  'ACTIVE_TEXTURE',
  'ACTIVE_UNIFORMS',
  'ACTIVE_UNIFORM_MAX_LENGTH',
  'ALIASED_LINE_WIDTH_RANGE',
  'ALIASED_POINT_SIZE_RANGE',
  'ALPHA',
  'ALPHA_BITS',
  'ALWAYS',
  'ARRAY_BUFFER',
  'ARRAY_BUFFER_BINDING',
  'ATTACHED_SHADERS',
  'BACK',
  'BLEND',
  'BLEND_COLOR',
  'BLEND_DST_ALPHA',
  'BLEND_DST_RGB',
  'BLEND_EQUATION',
  'BLEND_EQUATION_ALPHA',
  'BLEND_EQUATION_RGB',
  'BLEND_SRC_ALPHA',
  'BLEND_SRC_RGB',
  'BLUE_BITS',
  'BOOL',
  'BOOL_VEC2',
  'BOOL_VEC3',
  'BOOL_VEC4',
  'BROWSER_DEFAULT_WEBGL',
  'BUFFER_SIZE',
  'BUFFER_USAGE',
  'BYTE',
  'CCW',
  'CLAMP_TO_EDGE',
  'COLOR_ATTACHMENT0',
  'COLOR_BUFFER_BIT',
  'COLOR_CLEAR_VALUE',
  'COLOR_WRITEMASK',
  'COMPILE_STATUS',
  'COMPRESSED_TEXTURE_FORMATS',
  'CONSTANT_ALPHA',
  'CONSTANT_COLOR',
  'CONTEXT_LOST_WEBGL',
  'CULL_FACE',
  'CULL_FACE_MODE',
  'CURRENT_PROGRAM',
  'CURRENT_VERTEX_ATTRIB',
  'CW',
  'DECR',
  'DECR_WRAP',
  'DELETE_STATUS',
  'DEPTH_ATTACHMENT',
  'DEPTH_BITS',
  'DEPTH_BUFFER_BIT',
  'DEPTH_CLEAR_VALUE',
  'DEPTH_COMPONENT',
  'DEPTH_COMPONENT16',
  'DEPTH_FUNC',
  'DEPTH_RANGE',
  'DEPTH_STENCIL',
  'DEPTH_STENCIL_ATTACHMENT',
  'DEPTH_TEST',
  'DEPTH_WRITEMASK',
  'DITHER',
  'DONT_CARE',
  'DST_ALPHA',
  'DST_COLOR',
  'DYNAMIC_DRAW',
  'ELEMENT_ARRAY_BUFFER',
  'ELEMENT_ARRAY_BUFFER_BINDING',
  'EQUAL',
  'FASTEST',
  'FLOAT',
  'FLOAT_MAT2',
  'FLOAT_MAT3',
  'FLOAT_MAT4',
  'FLOAT_VEC2',
  'FLOAT_VEC3',
  'FLOAT_VEC4',
  'FRAGMENT_SHADER',
  'FRAMEBUFFER',
  'FRAMEBUFFER_ATTACHMENT_OBJECT_NAME',
  'FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE',
  'FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE',
  'FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL',
  'FRAMEBUFFER_BINDING',
  'FRAMEBUFFER_COMPLETE',
  'FRAMEBUFFER_INCOMPLETE_ATTACHMENT',
  'FRAMEBUFFER_INCOMPLETE_DIMENSIONS',
  'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT',
  'FRAMEBUFFER_UNSUPPORTED',
  'FRONT',
  'FRONT_AND_BACK',
  'FRONT_FACE',
  'FUNC_ADD',
  'FUNC_REVERSE_SUBTRACT',
  'FUNC_SUBTRACT',
  'GENERATE_MIPMAP_HINT',
  'GEQUAL',
  'GREATER',
  'GREEN_BITS',
  'HIGH_FLOAT',
  'HIGH_INT',
  'INCR',
  'INCR_WRAP',
  'INFO_LOG_LENGTH',
  'INT',
  'INT_VEC2',
  'INT_VEC3',
  'INT_VEC4',
  'INVALID_ENUM',
  'INVALID_FRAMEBUFFER_OPERATION',
  'INVALID_OPERATION',
  'INVALID_VALUE',
  'INVERT',
  'KEEP',
  'LEQUAL',
  'LESS',
  'LINEAR',
  'LINEAR_MIPMAP_LINEAR',
  'LINEAR_MIPMAP_NEAREST',
  'LINES',
  'LINE_LOOP',
  'LINE_STRIP',
  'LINE_WIDTH',
  'LINK_STATUS',
  'LOW_FLOAT',
  'LOW_INT',
  'LUMINANCE',
  'LUMINANCE_ALPHA',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'MAX_CUBE_MAP_TEXTURE_SIZE',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_TEXTURE_SIZE',
  'MAX_VARYING_VECTORS',
  'MAX_VERTEX_ATTRIBS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_VIEWPORT_DIMS',
  'MEDIUM_FLOAT',
  'MEDIUM_INT',
  'MIRRORED_REPEAT',
  'NEAREST',
  'NEAREST_MIPMAP_LINEAR',
  'NEAREST_MIPMAP_NEAREST',
  'NEVER',
  'NICEST',
  'NONE',
  'NOTEQUAL',
  'NO_ERROR',
  'NUM_COMPRESSED_TEXTURE_FORMATS',
  'ONE',
  'ONE_MINUS_CONSTANT_ALPHA',
  'ONE_MINUS_CONSTANT_COLOR',
  'ONE_MINUS_DST_ALPHA',
  'ONE_MINUS_DST_COLOR',
  'ONE_MINUS_SRC_ALPHA',
  'ONE_MINUS_SRC_COLOR',
  'OUT_OF_MEMORY',
  'PACK_ALIGNMENT',
  'POINTS',
  'POLYGON_OFFSET_FACTOR',
  'POLYGON_OFFSET_FILL',
  'POLYGON_OFFSET_UNITS',
  'RED_BITS',
  'RENDERBUFFER',
  'RENDERBUFFER_ALPHA_SIZE',
  'RENDERBUFFER_BINDING',
  'RENDERBUFFER_BLUE_SIZE',
  'RENDERBUFFER_DEPTH_SIZE',
  'RENDERBUFFER_GREEN_SIZE',
  'RENDERBUFFER_HEIGHT',
  'RENDERBUFFER_INTERNAL_FORMAT',
  'RENDERBUFFER_RED_SIZE',
  'RENDERBUFFER_STENCIL_SIZE',
  'RENDERBUFFER_WIDTH',
  'RENDERER',
  'REPEAT',
  'REPLACE',
  'RGB',
  'RGB5_A1',
  'RGB565',
  'RGBA',
  'RGBA4',
  'SAMPLER_2D',
  'SAMPLER_CUBE',
  'SAMPLES',
  'SAMPLE_ALPHA_TO_COVERAGE',
  'SAMPLE_BUFFERS',
  'SAMPLE_COVERAGE',
  'SAMPLE_COVERAGE_INVERT',
  'SAMPLE_COVERAGE_VALUE',
  'SCISSOR_BOX',
  'SCISSOR_TEST',
  'SHADER_COMPILER',
  'SHADER_SOURCE_LENGTH',
  'SHADER_TYPE',
  'SHADING_LANGUAGE_VERSION',
  'SHORT',
  'SRC_ALPHA',
  'SRC_ALPHA_SATURATE',
  'SRC_COLOR',
  'STATIC_DRAW',
  'STENCIL_ATTACHMENT',
  'STENCIL_BACK_FAIL',
  'STENCIL_BACK_FUNC',
  'STENCIL_BACK_PASS_DEPTH_FAIL',
  'STENCIL_BACK_PASS_DEPTH_PASS',
  'STENCIL_BACK_REF',
  'STENCIL_BACK_VALUE_MASK',
  'STENCIL_BACK_WRITEMASK',
  'STENCIL_BITS',
  'STENCIL_BUFFER_BIT',
  'STENCIL_CLEAR_VALUE',
  'STENCIL_FAIL',
  'STENCIL_FUNC',
  'STENCIL_INDEX',
  'STENCIL_INDEX8',
  'STENCIL_PASS_DEPTH_FAIL',
  'STENCIL_PASS_DEPTH_PASS',
  'STENCIL_REF',
  'STENCIL_TEST',
  'STENCIL_VALUE_MASK',
  'STENCIL_WRITEMASK',
  'STREAM_DRAW',
  'SUBPIXEL_BITS',
  'TEXTURE',
  'TEXTURE0',
  'TEXTURE1',
  'TEXTURE2',
  'TEXTURE3',
  'TEXTURE4',
  'TEXTURE5',
  'TEXTURE6',
  'TEXTURE7',
  'TEXTURE8',
  'TEXTURE9',
  'TEXTURE10',
  'TEXTURE11',
  'TEXTURE12',
  'TEXTURE13',
  'TEXTURE14',
  'TEXTURE15',
  'TEXTURE16',
  'TEXTURE17',
  'TEXTURE18',
  'TEXTURE19',
  'TEXTURE20',
  'TEXTURE21',
  'TEXTURE22',
  'TEXTURE23',
  'TEXTURE24',
  'TEXTURE25',
  'TEXTURE26',
  'TEXTURE27',
  'TEXTURE28',
  'TEXTURE29',
  'TEXTURE30',
  'TEXTURE31',
  'TEXTURE_2D',
  'TEXTURE_BINDING_2D',
  'TEXTURE_BINDING_CUBE_MAP',
  'TEXTURE_CUBE_MAP',
  'TEXTURE_CUBE_MAP_NEGATIVE_X',
  'TEXTURE_CUBE_MAP_NEGATIVE_Y',
  'TEXTURE_CUBE_MAP_NEGATIVE_Z',
  'TEXTURE_CUBE_MAP_POSITIVE_X',
  'TEXTURE_CUBE_MAP_POSITIVE_Y',
  'TEXTURE_CUBE_MAP_POSITIVE_Z',
  'TEXTURE_MAG_FILTER',
  'TEXTURE_MIN_FILTER',
  'TEXTURE_WRAP_S',
  'TEXTURE_WRAP_T',
  'TRIANGLES',
  'TRIANGLE_FAN',
  'TRIANGLE_STRIP',
  'UNPACK_ALIGNMENT',
  'UNPACK_COLORSPACE_CONVERSION_WEBGL',
  'UNPACK_FLIP_Y_WEBGL',
  'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
  'UNSIGNED_BYTE',
  'UNSIGNED_INT',
  'UNSIGNED_SHORT',
  'UNSIGNED_SHORT_4_4_4_4',
  'UNSIGNED_SHORT_5_5_5_1',
  'UNSIGNED_SHORT_5_6_5',
  'VALIDATE_STATUS',
  'VENDOR',
  'VERSION',
  'VERTEX_ATTRIB_ARRAY_BUFFER_BINDING',
  'VERTEX_ATTRIB_ARRAY_ENABLED',
  'VERTEX_ATTRIB_ARRAY_NORMALIZED',
  'VERTEX_ATTRIB_ARRAY_POINTER',
  'VERTEX_ATTRIB_ARRAY_SIZE',
  'VERTEX_ATTRIB_ARRAY_STRIDE',
  'VERTEX_ATTRIB_ARRAY_TYPE',
  'VERTEX_SHADER',
  'VIEWPORT',
  'ZERO'
];
