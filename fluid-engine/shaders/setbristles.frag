precision highp float;

uniform vec3 u_brushPosition;
uniform float u_brushScale;
uniform float u_bristleCount;

uniform float u_bristleLength; //length of total bristle
uniform float u_verticesPerBristle;

uniform sampler2D u_randomsTexture;
uniform vec2 u_resolution;

uniform float u_jitter;

/* Phase 8a: one value per press, drawn by Brush.initialize().
 * Perturbs each bristle's own jitter rather than rotating the brush rigidly --
 * a single shared angle would read as a stamp being visibly spun. */
uniform float u_strokeVariation;

const float PHI = 1.618033988749895;
const float PI = 3.14159265;

void main () {
    vec2 coordinates = gl_FragCoord.xy / u_resolution;

    vec4 randoms = texelFetch2D(u_randomsTexture, coordinates, u_resolution);

    float bristleIndex = floor(gl_FragCoord.x); //which bristle
    float vertexIndex = floor(gl_FragCoord.y);

    //jittered sunflower distribution

    /* Decorrelate the two components: adding the same offset to both would
     * move every bristle along one diagonal of jitter space, so taps would
     * still look like copies. The second offset is the golden-ratio conjugate
     * and its complement, which keeps x and y sequences mutually irrational.
     * Constants recorded here per the Phase 8a spec. */
    vec2 strokeRandom = fract(
        randoms.zw + vec2(u_strokeVariation,
                          u_strokeVariation * 0.61803398875 + 0.38196601125));

    float theta = (bristleIndex + (strokeRandom.x - 0.5) * u_jitter) * 2.0 * PI / (PHI * PHI);
    float r = sqrt(bristleIndex + (strokeRandom.y - 0.5) * u_jitter) / sqrt(u_bristleCount);

    float spacing = u_bristleLength / (u_verticesPerBristle - 1.0);
    vec3 brushSpaceBristlePosition = vec3(r * cos(theta), r * sin(theta), -vertexIndex * spacing);

    vec3 bristlePosition = u_brushPosition + brushSpaceBristlePosition * u_brushScale;

    gl_FragColor = vec4(bristlePosition, 1.0);
}
