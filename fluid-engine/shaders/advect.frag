precision highp float;

// varying vec2 v_coordinates;

uniform sampler2D u_velocityTexture;
uniform sampler2D u_inputTexture;

uniform float u_deltaTime;
uniform float u_dissipation;

uniform vec2 u_resolution;

uniform vec2 u_min;
uniform vec2 u_max;

/*
 * Explicit bilinear sampling.
 *
 * Mobile GPUs without OES_texture_float_linear cannot filter FLOAT textures:
 * such a texture is incomplete and every fetch returns vec4(0,0,0,1). So the
 * float textures are created with NEAREST filtering and any site that actually
 * needs interpolation does it here instead of relying on the sampler.
 *
 * `resolution` is the texture's size in texels.
 */
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

void main () {
    //RK2

    vec2 coordinates = gl_FragCoord.xy;
    vec2 velocity = bilinear(u_velocityTexture, coordinates / u_resolution, u_resolution).rg * 100.0;

    vec2 halfCoordinates = coordinates - velocity * 0.5 * u_deltaTime;
    vec2 halfVelocity = bilinear(u_velocityTexture, clamp(halfCoordinates, u_min, u_max) / u_resolution, u_resolution).rg * 100.0;

    vec2 finalCoordinates = coordinates - halfVelocity * u_deltaTime;

    gl_FragColor = bilinear(u_inputTexture, clamp(finalCoordinates, u_min, u_max) / u_resolution, u_resolution) * u_dissipation;
}
