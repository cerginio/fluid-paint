class Rectangle {
    constructor(left, bottom, width, height) {
      this.left = left;
      this.bottom = bottom;
      this.width = width;
      this.height = height;
    }
  
    getRight() {
      return this.left + this.width;
    }
  
    getTop() {
      return this.bottom + this.height;
    }
  
    setRight(right) {
      this.width = right - this.left;
      return this;
    }
  
    setTop(top) {
      this.height = top - this.bottom;
      return this;
    }
  
    clone() {
      return new Rectangle(this.left, this.bottom, this.width, this.height);
    }
  
    includeRectangle(rectangle) {
      const newRight = Math.max(this.getRight(), rectangle.getRight());
      const newTop = Math.max(this.getTop(), rectangle.getTop());
  
      this.left = Math.min(this.left, rectangle.left);
      this.bottom = Math.min(this.bottom, rectangle.bottom);
  
      this.setRight(newRight);
      this.setTop(newTop);
  
      return this;
    }
  
    intersectRectangle(rectangle) {
      const newRight = Math.min(this.getRight(), rectangle.getRight());
      const newTop = Math.min(this.getTop(), rectangle.getTop());
  
      this.left = Math.max(this.left, rectangle.left);
      this.bottom = Math.max(this.bottom, rectangle.bottom);
  
      this.setRight(newRight);
      this.setTop(newTop);
  
      return this;
    }
  
    translate(x, y) {
      this.left += x;
      this.bottom += y;
      return this;
    }
  
    scale(x, y) {
      this.left *= x;
      this.bottom *= y;
      this.width *= x;
      this.height *= y;
      return this;
    }
  
    round() {
      this.left = Math.round(this.left);
      this.bottom = Math.round(this.bottom);
      this.width = Math.round(this.width);
      this.height = Math.round(this.height);
    }
  
    getArea() {
      return this.width * this.height;
    }
  }
  
  // If using modules:
  // export default Rectangle;
  