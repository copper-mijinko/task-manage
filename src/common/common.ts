// tooltip
export function tooltip(
  node, 
  params={
          backgroundColor: "white",
          color: "black",
          content: undefined,
          disable: false,
          wrapped: false,
          force: false
        }
){
  const backgroundColor = params.backgroundColor;
  const color = params.color;
  const disable = params.disable;
  const force = params.force;

  const judge = () => {
    return !disable && (force || node.scrollWidth > node.offsetWidth);
  }

  let tooltip;
  const handleMouseEnter = (e) => {
    if (!judge()) {
      return;
    }
    tooltip = document.createElement("div");
    if (params.content) {
      tooltip.textContent = params.content;
    } else {
      tooltip.textContent = node.textContent? node.textContent: node.value;
    }
		tooltip.style = `
      display: flex;
      justify-content: center;
      align-items: center;
			border: none;
      color: ${color};
			background-color: ${backgroundColor};
      box-shadow: 0 .2rem .5rem rgba(0,0,0,0.25), 0 .1em .25rem rgba(0,0,0,0);
      border-radius: 0.5rem;
			padding: 0.5rem;
			position: fixed;
			top: calc(${e.pageX}px + 1rem);
			left: calc(${e.pageY}px + 1rem);
      z-index: 9999999999999999999;
		`;
    document.body.appendChild(tooltip);
  }
  const handleMouseLeave = (e) => {
    if (document.body.contains(tooltip)) {
      document.body.removeChild(tooltip);
    }
  }
  const handleMouseMove = (e) => {
    if (tooltip) {
      tooltip.style.left = `calc(${e.pageX}px + 1rem)`;
      tooltip.style.top = `calc(${e.pageY}px + 1rem)`;
    }
  }
  const target = params.wrapped? node.parentElement: node;
  target.addEventListener('mouseenter', handleMouseEnter);
  target.addEventListener('mouseleave', handleMouseLeave);
	target.addEventListener('mousemove', handleMouseMove);

  return {
    destroy() {
      target.removeEventListener('mouseenter', handleMouseEnter);
      target.removeEventListener('mouseleave', handleMouseLeave);
      target.removeEventListener('mousemove', handleMouseMove);
    }
  }
}

// ripple
export function ripple(
  node,
  params={
          duration: 500,
          color: "rgba(0, 0, 0, 0.16)",
          disable: false,
         }
){
  const duration = params.duration;
  const color = params.color;
  const disable = params.disable;
  if (disable) {
    return;
  }
  const handleClick = (e) => {
    if (!node.contains(e.target)) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);

    if (style.zIndex == "auto") {
      node.style.zIndex = 0;
    }

    const clone = document.createElement("span");
    clone.style.position = "fixed";
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.borderRadius = style.borderRadius;
    clone.style.overflow = "hidden";
    clone.style.backgroundColor = "transparent";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "2147483647";

    node.appendChild(clone);

    const x = e.clientX;
    const y = e.clientY;
    const bt = rect.top;
    const bl = rect.left;
    
    const circle = document.createElement("span");
    circle.classList.add("circle");
    const size = Math.max(rect.width, rect.height);
    circle.style.top = `${y-bt-size/2}px`;
    circle.style.left = `${x-bl-size/2}px`;
    circle.style.width = `${size}px`;
    circle.style.height = `${size}px`;
    circle.style.backgroundColor = color;
    circle.style.position = "absolute";
    circle.style.borderRadius = "50%";
    circle.animate({
      opacity: [1, 0],
      scale: [0, 2]
    }, {
      duration: duration,
      easing: "ease-out"
    })
    
    setTimeout(()=>{
      clone.remove();
    }, duration*0.8);

    clone.appendChild(circle);
  };

  node.addEventListener("click", handleClick);

  return {
    destroy() {
      node.removeEventListener("click", handleClick);
    }
  }
}

// clickOutside
export function clickOutside(node) {
	const handleClick = (event) => {
    const rect = node.getBoundingClientRect();
		if (!node.contains(event.target) && rect.width && rect.height) {
			node.dispatchEvent(new CustomEvent("outclick"));
		}
	};

	document.addEventListener("click", handleClick, true);

	return {
		destroy() {
			document.removeEventListener("click", handleClick, true);
		}
	};
}
