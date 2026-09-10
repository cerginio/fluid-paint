precision highp float;

uniform vec2 u_focus;
uniform vec4 u_color;

void main() {
  vec2 delta = gl_FragCoord.xy - u_focus;
  vec2 distanceFromCenter = abs(delta);
  const float radius = 18.0;
  const float arm = 9.0;
  const float thickness = 1.5;

  bool onVertical = abs(distanceFromCenter.x - radius) <= thickness &&
    distanceFromCenter.y >= radius - arm && distanceFromCenter.y <= radius;
  bool onHorizontal = abs(distanceFromCenter.y - radius) <= thickness &&
    distanceFromCenter.x >= radius - arm && distanceFromCenter.x <= radius;

  if (onVertical || onHorizontal) {
    gl_FragColor = u_color;
  } else {
    discard;
  }
}
