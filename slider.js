// ES6 class version of Slider

const SLIDER_THICKNESS = 2;
const LEFT_COLOR = 'white';
const RIGHT_COLOR = '#666666';
const HANDLE_COLOR = 'white';

class Slider {
  /**
   * @param {HTMLElement} element
   * @param {number} initialValue
   * @param {number} minValue
   * @param {number} maxValue
   * @param {(val:number)=>void} changeCallback
   */
  constructor(element, initialValue, minValue, maxValue, changeCallback) {
    this.div = element;
    this.minValue = minValue;
    this.maxValue = maxValue;
    this.changeCallback = changeCallback;

    const height = element.offsetHeight;
    const length = element.offsetWidth;

    // Track value internally
    this.value = initialValue;

    // Left (filled) track
    const sliderLeftDiv = document.createElement('div');
    sliderLeftDiv.style.position = 'absolute';
    sliderLeftDiv.style.width = length + 'px';
    sliderLeftDiv.style.height = SLIDER_THICKNESS.toFixed(0) + 'px';
    sliderLeftDiv.style.backgroundColor = LEFT_COLOR;
    sliderLeftDiv.style.top = height / 2 - 1 + 'px';
    sliderLeftDiv.style.zIndex = 999;
    element.appendChild(sliderLeftDiv);

    // Right (unfilled) track
    const sliderRightDiv = document.createElement('div');
    sliderRightDiv.style.position = 'absolute';
    sliderRightDiv.style.width = length + 'px';
    sliderRightDiv.style.height = SLIDER_THICKNESS.toFixed(0) + 'px';
    sliderRightDiv.style.backgroundColor = RIGHT_COLOR;
    sliderRightDiv.style.top = height / 2 - 1 + 'px';
    element.appendChild(sliderRightDiv);

    // Handle
    const handleDiv = document.createElement('div');
    handleDiv.style.position = 'absolute';
    handleDiv.style.width = height + 'px';
    handleDiv.style.height = height + 'px';
    handleDiv.style.borderRadius = height * 0.5 + 'px';
    handleDiv.style.cursor = 'ew-resize';
    handleDiv.style.background = HANDLE_COLOR;
    element.appendChild(handleDiv);

    // Redraw UI from current value
    const redraw = () => {
      const fraction = (this.value - this.minValue) / (this.maxValue - this.minValue);
      sliderLeftDiv.style.width = fraction * length + 'px';
      sliderRightDiv.style.width = (1.0 - fraction) * length + 'px';
      sliderRightDiv.style.left = Math.floor(fraction * length) + 'px';
      handleDiv.style.left = Math.floor(fraction * length) - element.offsetHeight / 2 + 'px';
    };

    // Apply a pointer change
    const onChange = (event) => {
      const mouseX = Utilities.getMousePosition(event, element).x;
      this.value = Utilities.clamp(
        (mouseX / length) * (this.maxValue - this.minValue) + this.minValue,
        this.minValue,
        this.maxValue
      );

      this.changeCallback(this.value);
      redraw();
    };

    // Events
    let mousePressed = false;

    element.addEventListener('mousedown', (event) => {
      mousePressed = true;
      onChange(event);
    });

    document.addEventListener('mouseup', () => {
      mousePressed = false;
    });

    document.addEventListener('mousemove', (event) => {
      if (mousePressed) onChange(event);
    });

    element.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const firstTouch = event.targetTouches[0];
      onChange(firstTouch);
    });

    element.addEventListener('touchmove', (event) => {
      event.preventDefault();
      const firstTouch = event.targetTouches[0];
      onChange(firstTouch);
    });

    // Public API (same as original)
    this.setValue = (newValue) => {
      this.value = newValue;
      redraw();
    };

    this.getValue = () => this.value;

    redraw();
  }
}

// If using modules:
// export default Slider;
