 precision highp float;
  
    uniform vec2 u_bottomLeft;    // rectangle bottom-left in screen pixels
    uniform vec2 u_topRight;      // rectangle top-right  in screen pixels
    uniform float u_thickness;    // border thickness in pixels
    uniform vec4 u_color;         // RGBA for the outline
  
    void main() {
      vec2 p = gl_FragCoord.xy;
      // quick reject if outside the rectangle's bounding box extended by thickness
      if (p.x < u_bottomLeft.x - u_thickness || p.x > u_topRight.x + u_thickness ||
          p.y < u_bottomLeft.y - u_thickness || p.y > u_topRight.y + u_thickness) {
        discard;
      }
  
      // near any of the four edges?
      bool onLeft   = abs(p.x - u_bottomLeft.x) <= u_thickness && p.y >= u_bottomLeft.y - u_thickness && p.y <= u_topRight.y + u_thickness;
      bool onRight  = abs(p.x - u_topRight.x)   <= u_thickness && p.y >= u_bottomLeft.y - u_thickness && p.y <= u_topRight.y + u_thickness;
      bool onBottom = abs(p.y - u_bottomLeft.y) <= u_thickness && p.x >= u_bottomLeft.x - u_thickness && p.x <= u_topRight.x + u_thickness;
      bool onTop    = abs(p.y - u_topRight.y)   <= u_thickness && p.x >= u_bottomLeft.x - u_thickness && p.x <= u_topRight.x + u_thickness;
  
      if (onLeft || onRight || onBottom || onTop) {
        gl_FragColor = u_color;
      } else {
        discard;
      }
    }