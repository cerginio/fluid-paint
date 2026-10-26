precision highp float;

attribute vec2 a_position;
uniform vec2 u_boundsMin;
uniform vec2 u_boundsMax;
uniform vec2 u_paintingDimensions;
uniform vec2 u_paintingPosition;
varying vec2 v_position;

void main() {
    v_position = mix(u_boundsMin, u_boundsMax, (a_position + 1.0) * 0.5);
    gl_Position = vec4(-1.0 + 2.0 * (v_position - u_paintingPosition) /
        u_paintingDimensions, 0.0, 1.0);
}
