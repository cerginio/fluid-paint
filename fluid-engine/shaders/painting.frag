precision highp float;

varying vec2 v_coordinates;

uniform sampler2D u_paintTexture;

uniform vec2 u_paintingSize; //painting size in pixels
uniform vec2 u_paintingPosition; //bottom left position in pixels
uniform vec2 u_paintingResolution;

uniform float u_normalScale;

uniform vec3 u_lightDirection;
uniform float u_roughness;
uniform float u_F0;
uniform float u_diffuseScale;
uniform float u_specularScale;

#ifdef RESIZING
uniform float u_featherSize;
#endif

vec3 trilinearInterpolate(vec3 p, vec3 v000, vec3 v100, vec3 v010, vec3 v001, vec3 v101, vec3 v011, vec3 v110, vec3 v111) {
    return v000 * (1.0 - p.x) * (1.0 - p.y) * (1.0 - p.z) +
           v100 * p.x * (1.0 - p.y) * (1.0 - p.z) +
           v010 * (1.0 - p.x) * p.y * (1.0 - p.z) +
           v001 * (1.0 - p.x) * (1.0 - p.y) * p.z +
           v101 * p.x * (1.0 - p.y) * p.z +
           v011 * (1.0 - p.x) * p.y * p.z +
           v110 * p.x * p.y * (1.0 - p.z) +
           v111 * p.x * p.y * p.z;
}

/* The cube's all-three-pigments corner.
 *
 * David Li's original is vec3(0.2, 0.094, 0.0) -- a near-black brown, and the
 * DARKEST colour this cube can produce. There is no black in it at all, so a
 * picker built on it cannot offer one: mixing every pigment at full load is as
 * dark as paint gets.
 *
 * A host may deepen this corner to true black (the blackPigment feature flag,
 * see fluid-engine/index.js). It is a uniform rather than a #define so the flag
 * costs no extra shader programs and can flip at runtime.
 *
 * Only the p.x*p.y*p.z term uses it, so the change is invisible unless all
 * three pigments are present: every pure hue and every two-pigment mix
 * (orange, green, purple) is bit-identical either way. Measured deltas are 0
 * for those, 6/255 at a middling three-way mix, 51/255 at the corner itself.
 */
uniform vec3 u_pigmentBlack;

vec3 rybToRgb(vec3 ryb) {
#ifdef RGB
    return 1.0 - ryb.yxz;
#endif

    return trilinearInterpolate(ryb, 
        vec3(1.0, 1.0, 1.0), 
        vec3(1.0, 0.0, 0.0), 
        vec3(0.163, 0.373, 0.6), 
        vec3(1.0, 1.0, 0.0), 
        vec3(1.0, 0.5, 0.0), 
        vec3(0.0, 0.66, 0.2),
        vec3(0.5, 0.0, 0.5),
        u_pigmentBlack);
}


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

//samples with feathering at the edges
vec4 samplePaintTexture (vec2 coordinates) {
    vec4 value = bilinear(u_paintTexture, coordinates, u_paintingResolution);

#ifdef RESIZING
    vec2 featherSize = u_featherSize / u_paintingResolution;
    float scale = smoothstep(-featherSize.x, 0.0, coordinates.x) * smoothstep(-featherSize.y, 0.0, coordinates.y)
                  * smoothstep(1.0 + featherSize.x, 1.0, coordinates.x) * smoothstep(1.0 + featherSize.y, 1.0, coordinates.y);
    return value * scale;
#else
    return value;
#endif
}

float getHeight (vec2 coordinates) {
    return samplePaintTexture(coordinates).a;
}


vec2 computeGradient(vec2 coordinates) { //sobel operator
    vec2 delta = 1.0 / u_paintingResolution;

    float topLeft = getHeight(coordinates + vec2(-delta.x, delta.y));
    float top = getHeight(coordinates + vec2(0.0, delta.y));
    float topRight = getHeight(coordinates + vec2(delta.x, delta.y));

    float left = getHeight(coordinates + vec2(-delta.x, 0.0));
    float right = getHeight(coordinates + vec2(delta.x, 0.0));

    float bottomLeft = getHeight(coordinates + vec2(-delta.x, -delta.y));
    float bottom = getHeight(coordinates + vec2(0.0, -delta.y));
    float bottomRight = getHeight(coordinates + vec2(delta.x, -delta.y));
    
    return vec2(
         1.0 * topLeft - 1.0 * topRight + 2.0 * left - 2.0 * right + 1.0 * bottomLeft - 1.0 * bottomRight,
        -1.0 * topLeft + 1.0 * bottomLeft - 2.0 * top + 2.0 * bottom - 1.0 * topRight + 1.0 * bottomRight);
}


const float PI = 3.14159265;

float square (float x) {
    return x * x;
}

float fresnel (float F0, float lDotH) {
    float f = pow(1.0 - lDotH, 5.0);

    return (1.0 - F0) * f + F0;
}

float GGX (float alpha, float nDotH) {
    float a2 = square(alpha);

    return a2 / (PI * square(square(nDotH) * (a2 - 1.0) + 1.0));
}

float GGGX (float alpha, float nDotL, float nDotV) {
    float a2 = square(alpha);

    float gl = nDotL + sqrt(a2 + (1.0 - a2) * square(nDotL));
    float gv = nDotV + sqrt(a2 + (1.0 - a2) * square(nDotV));

    return 1.0 / (gl * gv);
}

float saturate (float x) {
    return clamp(x, 0.0, 1.0);
}

float specularBRDF (vec3 lightDirection, vec3 eyeDirection, vec3 normal, float roughness, float F0) {
    vec3 halfVector = normalize(lightDirection + eyeDirection);

    float nDotH = saturate(dot(normal, halfVector));
    float nDotL = saturate(dot(normal, lightDirection));
    float nDotV = saturate(dot(normal, eyeDirection));
    float lDotH = saturate(dot(lightDirection, halfVector));

    float D = GGX(roughness, nDotH);
    float G = GGGX(roughness, nDotL, nDotV);
    float F = fresnel(F0, lDotH);

    return D * G * F;
}

void main () {
#ifdef SAVE
    vec2 coordinates = vec2(v_coordinates.x, 1.0 - v_coordinates.y);
#else
    vec2 coordinates = (gl_FragCoord.xy - u_paintingPosition) / u_paintingSize;
#endif

    vec4 value = samplePaintTexture(coordinates); //r, g, b, height

    vec2 gradient = computeGradient(coordinates);
    vec3 normal = normalize(vec3(
        gradient.x,
        gradient.y,
        u_normalScale
    ));

    vec3 lightDirection = normalize(u_lightDirection);
    vec3 eyeDirection = vec3(0.0, 0.0, 1.0);

    float diffuse = saturate(dot(lightDirection, normal));
    diffuse = diffuse * u_diffuseScale + (1.0 - u_diffuseScale);


    float specular = specularBRDF(lightDirection, eyeDirection, normal, u_roughness, u_F0);

    vec3 color = rybToRgb(value.rgb);

    vec3 surfaceColor = color * diffuse + specular * u_specularScale;
    
    gl_FragColor = vec4(surfaceColor, 1.0);
}
