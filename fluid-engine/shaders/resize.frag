precision highp float;

uniform sampler2D u_paintTexture;

uniform vec2 u_oldResolution;
uniform vec2 u_offset; //in texels

uniform float u_featherSize;


//Explicit bilinear: FLOAT textures are NEAREST because mobile GPUs without
//OES_texture_float_linear cannot filter them (fetches return vec4(0,0,0,1)).
//See docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md

vec4 bilinear (sampler2D tex, vec2 uv, vec2 resolution) {
    vec2 texel = uv * resolution - 0.5;
    vec2 base = floor(texel);
    vec2 f = texel - base;

    vec2 t00 = (base + vec2(0.5, 0.5)) / resolution;
    vec2 t10 = (base + vec2(1.5, 0.5)) / resolution;
    vec2 t01 = (base + vec2(0.5, 1.5)) / resolution;
    vec2 t11 = (base + vec2(1.5, 1.5)) / resolution;

    return mix(mix(texture2D(tex, t00), texture2D(tex, t10), f.x),
               mix(texture2D(tex, t01), texture2D(tex, t11), f.x), f.y);
}

void main() {
    vec2 coordinates = (gl_FragCoord.xy - u_offset) / u_oldResolution;

    vec4 value = bilinear(u_paintTexture, coordinates, u_oldResolution);

    vec2 featherSize = u_featherSize / u_oldResolution;
    float scale = smoothstep(-featherSize.x, 0.0, coordinates.x) 
                * smoothstep(-featherSize.y, 0.0, coordinates.y) 
                * smoothstep(1.0 + featherSize.x, 1.0, coordinates.x) 
                * smoothstep(1.0 + featherSize.y, 1.0, coordinates.y);

    gl_FragColor = value * scale;
}
