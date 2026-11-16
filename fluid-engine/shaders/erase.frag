precision highp float;

/*
 * Material eraser: remove paint, reveal the canvas (or the PNG background).
 *
 * RGB stores pigment load and A stores height, and both are >= 0. Zero in all
 * four channels is the engine's empty material, which painting.frag already
 * renders as untouched paper. So erasing is a scale toward zero, never a
 * colour: there is no "white paint" here to leave a patch behind.
 *
 * One gesture must give the same edge however the pointer was sampled. If
 * each segment scaled the CURRENT paint by (1 - mask), a feather texel hit by
 * ten overlapping segments at 0.2 would lose 89%, not 20%, and the edge would
 * depend on pointer speed. Instead the gesture keeps an immutable baseline
 * and every texel is
 *
 *     baseline * (1 - max over segments of mask)
 *
 * Because every channel is non-negative, that equals
 *
 *     min(current, baseline * (1 - mask))
 *
 * one segment at a time -- so no coverage texture is needed, a repeated or
 * subdivided segment changes nothing, and a texel outside the mask is written
 * back bit-for-bit (mask 0 gives baseline, and current <= baseline).
 */

uniform sampler2D u_paintTexture;     // current paint, the ping-pong source
uniform sampler2D u_baselineTexture;  // paint at the start of the gesture

uniform vec2 u_resolution;            // simulation texels
uniform vec2 u_paintingDimensions;    // painting, world units
uniform vec2 u_paintingPosition;      // painting bottom-left, world units

uniform vec2 u_from;                  // segment endpoints, world units
uniform vec2 u_to;
uniform float u_radius;               // world units
uniform float u_feather;              // world units, 0 < feather <= radius

// 1 when a PNG background is installed. See the edge rule in main().
uniform float u_revealBackground;

float distanceToSegment(vec2 a, vec2 b, vec2 p) {
    vec2 ab = b - a;
    float lengthSquared = dot(ab, ab);
    // A tap, or a pointer that has not moved: a point, not a line.
    if (lengthSquared < 1e-12) return distance(a, p);
    float t = clamp(dot(p - a, ab) / lengthSquared, 0.0, 1.0);
    return distance(p, a + t * ab);
}

void main () {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // Measured in world units, not UV, so the footprint stays a circle when
    // the simulation's x and y scales differ by a rounding texel.
    vec2 world = u_paintingPosition + uv * u_paintingDimensions;
    float d = distanceToSegment(u_from, u_to, world);

    // 1 inside radius - feather, 0 beyond radius, smooth between.
    float mask = 1.0 - smoothstep(u_radius - u_feather, u_radius, d);

    vec4 current = texture2D(u_paintTexture, uv);
    vec4 baseline = texture2D(u_baselineTexture, uv);

    // Exact zero inside, so a fully erased texel is empty material and not a
    // float residue that still tints or lifts the surface.
    vec4 removed;
    if (mask >= 1.0) {
        removed = vec4(0.0);
    } else if (u_revealBackground > 0.5 && mask > 0.0) {
        // Over a background, painting.frag shows mix(background, paint,
        // saturate(height)). Scaling pigment toward zero there renders as
        // WHITE paint, and thick paint (height > 1) stays fully opaque until
        // the last texel -- a pale ring around every hole. So on the edge
        // band keep the pigment and cap the height at (1 - mask): the paint
        // then blends straight into the image underneath.
        removed = vec4(baseline.rgb, min(baseline.a, 1.0) * (1.0 - mask));
    } else {
        // On paper, less pigment IS the fade to paper white.
        removed = baseline * (1.0 - mask);
    }
    // Both rules only ever decrease with mask, which is what keeps the min()
    // below equal to "the strongest coverage this gesture has applied".

    gl_FragColor = min(current, removed);
}
