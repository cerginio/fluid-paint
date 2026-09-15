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

/* Phase B: bristle footprint.
 *
 * u_bristleSides < 3.0 is the round default and costs nothing beyond one
 * compare -- the disc path below is bit-identical to the pre-shape shader.
 * 3..8 clamp the sunflower into a regular n-gon; u_bristleAspect then scales
 * x against y so a square becomes a rectangle. u_bristleRotation orients the
 * polygon, in radians. */
uniform float u_bristleSides;
uniform float u_bristleAspect;
uniform float u_bristleRotation;

const float PHI = 1.618033988749895;
const float PI = 3.14159265;

/*
 * Normalized radius of a regular n-gon at angle theta, as a fraction of its
 * circumradius: 1.0 at a vertex, cos(PI/n) at an edge midpoint.
 *
 * Folding theta into one wedge with mod() means the cost is independent of the
 * side count -- no loop, no branch per side. This runs for every bristle on
 * every simulation step (brush.js re-pins the bases each step), so it stays
 * pure arithmetic on mobile GPUs.
 */
float polygonRadius(float theta, float sides) {
    float halfWedge = PI / sides;
    return cos(halfWedge) / cos(mod(theta, 2.0 * halfWedge) - halfWedge);
}

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
    vec2 crossSection = vec2(r * cos(theta), r * sin(theta));

    if (u_bristleSides >= 3.0) {
        /* Clamp the disc into the polygon by scaling each bristle's radius by
         * the polygon's own radius at that angle. Because r = sqrt(i/N) is an
         * equal-area distribution, scaling it radially maps that even density
         * onto the polygon -- bristles do not bunch up at the vertices, which
         * is what rejection sampling or vertex snapping would produce.
         *
         * The clamp is applied AFTER the jitter above, so this press's
         * variation survives intact rather than being quantized by the shape. */
        /* Rotation must only bias the polygon lookup, not theta itself: theta
         * is the position angle that places this bristle around the disc, and
         * bristleIndex sweeps it densely over the full sunflower sequence --
         * shifting theta by a constant before using it as the position angle
         * just relabels which bristle lands at which angle, so the painted
         * shape (the set of positions) comes out identical for every
         * rotation. Only polygonRadius's fold is periodic in a way that a
         * shift actually moves, so the rotation goes in there alone. */
        float shaped = r * polygonRadius(theta + u_bristleRotation, u_bristleSides);

        /* An n-gon inscribed in the unit disc covers less area than the disc,
         * so the same brushSize would paint a visibly thinner stroke -- a
         * triangle loses about half. Divide by the shape's area fraction
         * (n/(2*PI) * sin(2*PI/n)) so a shaped brush keeps the round brush's
         * covered area and brushSize keeps meaning one thing. */
        float wedge = 2.0 * PI / u_bristleSides;
        float areaFraction = (u_bristleSides / (2.0 * PI)) * sin(wedge);
        shaped /= sqrt(areaFraction);

        crossSection = vec2(shaped * cos(theta), shaped * sin(theta));
        // Aspect stretches x against y; 1.0 leaves a regular polygon alone.
        crossSection.x *= u_bristleAspect;
        crossSection /= sqrt(u_bristleAspect); // keep area independent of aspect
    }

    vec3 brushSpaceBristlePosition = vec3(crossSection, -vertexIndex * spacing);

    vec3 bristlePosition = u_brushPosition + brushSpaceBristlePosition * u_brushScale;

    gl_FragColor = vec4(bristlePosition, 1.0);
}
