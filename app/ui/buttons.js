// ES6 class version of Buttons

class Buttons {
    /**
     * @param {HTMLElement} element
     * @param {string[]} buttonNames
     * @param {number} initialActiveIndex
     * @param {(index:number)=>void} changeCallback
     */
    constructor(element, buttonNames, initialActiveIndex, changeCallback) {
      this.element = element;
      this.changeCallback = changeCallback;
      this.elements = [];
      this.activeIndex = initialActiveIndex;
  
      // Build buttons
      for (let i = 0; i < buttonNames.length; ++i) {
        const btn = document.createElement('div');
        btn.innerHTML = buttonNames[i];
        element.appendChild(btn);
        this.elements.push(btn);
  
        const onSelect = (event) => {
          event.preventDefault();
          if (this.activeIndex !== i) {
            this.activeIndex = i;
            this.changeCallback(i);
            this.refresh();
          }
        };
  
        btn.addEventListener('click', onSelect);
        btn.addEventListener('touchstart', onSelect);
      }
  
      this.refresh();
    }
  
    refresh() {
      for (let i = 0; i < this.elements.length; ++i) {
        this.elements[i].className =
          i === this.activeIndex ? 'button-selected' : 'button-unselected';
      }
    }
  
    // Public API (same as original)
    setIndex(index) {
      this.activeIndex = index;
      this.refresh();
    }
  }
  
  // If using modules:
  // export default Buttons;
  