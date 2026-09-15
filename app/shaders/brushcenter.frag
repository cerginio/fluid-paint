precision highp float;

uniform vec2 u_center;          // marker center, in screen pixels
uniform float u_radius;         // marker half-diagonal (vertex-to-center), in screen pixels
uniform sampler2D u_canvasTexture;
uniform vec2 u_canvasResolution;
uniform vec3 u_pigmentColor;    // the brush's own pigment, as displayed RGB

void main() {
    vec2 d = abs(gl_FragCoord.xy - u_center);
    // Symmetric diamond: |dx|/r + |dy|/r <= 1.
    float d1 = (d.x + d.y) / u_radius;
    if (d1 > 1.0) discard;

    vec3 background = texture2D(u_canvasTexture, gl_FragCoord.xy / u_canvasResolution).rgb;
    vec3 complementary = vec3(1.0) - background;

    // The fill is always the pigment itself -- it is the one thing this marker
    // exists to show. The ring around it is the background's complement, so
    // the diamond's silhouette stays legible even where the pigment happens to
    // sit close to the ground colour (the case a fixed dark ring could not
    // handle: dark pigment on a dark ground).
    float ringInner = 0.72; // fraction of u_radius where the ring starts
    vec3 fill = d1 > ringInner ? complementary : u_pigmentColor;

    gl_FragColor = vec4(fill, 1.0);
}
