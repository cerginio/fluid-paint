precision highp float;

uniform vec2 u_from;
uniform vec2 u_to;
uniform float u_hasOverlap;
uniform vec2 u_overlapFrom;
uniform vec2 u_overlapTo;
uniform float u_overlapRadius;
uniform vec2 u_pixelSize;
uniform float u_fromRadius;
uniform float u_toRadius;
uniform vec4 u_color;
varying vec2 v_position;

float capsuleCoverage(vec2 from, vec2 to, float fromRadius, float toRadius) {
    vec2 delta = to - from;
    float lengthSquared = dot(delta, delta);
    float t = lengthSquared > 0.0
        ? clamp(dot(v_position - from, delta) / lengthSquared, 0.0, 1.0)
        : 0.0;
    float radius = mix(fromRadius, toRadius, t);
    float distanceFromPath = length(v_position - mix(from, to, t));
    // A pixel's diagonal gives a conservative antialias footprint. Subpixel
    // paths retain proportional coverage instead of disappearing at radius 0.
    float feather = max(length(u_pixelSize), 0.0001);
    return clamp((radius - distanceFromPath) / feather + 0.5, 0.0, 1.0);
}

void main() {
    float coverage = capsuleCoverage(u_from, u_to, u_fromRadius, u_toRadius);
    if (u_hasOverlap > 0.5) {
        float previousCoverage = capsuleCoverage(u_overlapFrom, u_overlapTo,
            u_overlapRadius, u_overlapRadius);
        coverage = max(0.0, coverage - previousCoverage);
    }
    gl_FragColor = vec4(u_color.rgb, u_color.a * coverage);
}
