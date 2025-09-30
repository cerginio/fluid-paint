// ES6 class version of Utilities

class Utilities {
    static swap(object, a, b) {
      const temp = object[a];
      object[a] = object[b];
      object[b] = temp;
    }
  
    static clamp(x, min, max) {
      return Math.max(min, Math.min(max, x));
    }
  
    static getMousePosition(event, element) {
      const rect = element.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }
  }
  
  // If using modules:
  // export default Utilities;
  // or named exports:
  // export const { swap, clamp, getMousePosition } = Utilities;
  