<script>
	import { onMount } from 'svelte';

  export let defaultRatio = [];
  
	let split_pane_root; // Bind

  // Resize
  let resizers, handlers, resize_observer;

  // Min width
  let minWidth;

	onMount(() => {
    let panes;
    // Create resizres
		[resizers, panes, resize_observer] = createResizers();

    // Event listners
		handlers = setResizersEvents(resizers, panes);

    // Min width
    minWidth = `${4 * panes.length}rem` // magic number 4rem.

    // Observe slot change
    let mutation_observer = new MutationObserver(() => {
      let  panes;
      // Create resizres
      [resizers, panes] = createResizers(resizers, false, resize_observer);
      // Event listners
      unsetResizerEvents(resizers, handlers);
      handlers = setResizersEvents(resizers, panes);
    });
    mutation_observer.observe(split_pane_root, {subtree: true, childList: true});
	});

  const createResizers = (resizers=[], is_default=true, resize_observer=null) => {
    // Get elms
		let panes = split_pane_root.querySelectorAll(".Pane");
    // Default
    if (is_default) {
      // Set width
      if (panes.length > defaultRatio.length) {
        defaultRatio = defaultRatio.concat(new Array(panes.length - defaultRatio.length).fill(1));
      } else if (panes.length < defaultRatio.length) {
        defaultRatio = defaultRatio.slice(0, panes.length);
      }
      const defaultRatio_sum = defaultRatio.reduce((partialSum, a) => partialSum + a, 0);
      const default_root_width = split_pane_root.getBoundingClientRect().width;
      const default_pane_widths = defaultRatio.map((ratio) => default_root_width * ratio / defaultRatio_sum);
      panes.forEach((pane, index) => {
        pane.style.width = `calc(${default_pane_widths[index]}px)`;
      });
      // Create resizer
      let left = 0;
      panes.forEach((pane, index) => {
        if (index == 0) {
          return;
        }
        // Create resizer
        const resizer = document.createElement("div");
        resizer.classList.add('Resizer');
        resizer.style.height = `${split_pane_root.offsetHeight}px`;
        // Postions of resizer
        resizer.style.left = `${left + default_pane_widths[index - 1] - 3}px`;
        left += default_pane_widths[index - 1];
        // Add resizer into Dom
        pane.parentNode.insertBefore(resizer, pane);
        // Keep resizer
        resizers.push(resizer);
      })
    }
    // For split_pane_root resizing
    if (resize_observer) {
      resize_observer.disconnect(split_pane_root);
    }
    resize_observer = new ResizeObserver((entries) => {
      // Height setting
      for (let resizer of resizers) {
        resizer.style.height = `${entries[0].contentRect.height}px`;
      }
      // Width setting
      let root_width = 0;
      panes.forEach((pane, index) => {
        root_width += pane.getBoundingClientRect().width;
      });
      let new_root_width = entries[0].contentRect.width;
      let new_pane_widths = [];
      panes.forEach((pane, index) => {
        new_pane_widths.push(pane.getBoundingClientRect().width * new_root_width / root_width);
      });
      panes.forEach((pane, index) => {
        pane.style.width = `${new_pane_widths[index]}px`;
      });
      let left = 0;
      resizers.forEach((resizer, index) => {
        resizer.style.left = `${left + new_pane_widths[index] - 3}px`;
        left += new_pane_widths[index];
      });
    });
    resize_observer.observe(split_pane_root);
    // Return
    return [resizers, panes, resize_observer];
  }

	const setResizersEvents = (resizers, panes) => {
    const handlers = [];
    // Create resizers and their events
		for (let i=0; i<resizers.length; i++) {
			const pane = panes[i]
			const pane_r = panes[i+1]
			const resizer = resizers[i]

      const style_min_w = window.getComputedStyle(pane).minWidth;
			const min_w = style_min_w.includes('%') ? parseFloat(window.getComputedStyle(pane).minWidth, 10)/100*split_pane_root.getBoundingClientRect().width : parseFloat(window.getComputedStyle(pane).minWidth, 10) || 10;
      const style_min_wr = window.getComputedStyle(pane_r).minWidth;
			const min_wr = style_min_wr.includes('%') ? parseFloat(window.getComputedStyle(pane_r).minWidth, 10)/100*split_pane_root.getBoundingClientRect().width : parseFloat(window.getComputedStyle(pane_r).minWidth, 10) || 10;

			// Track the current position of mouse
			let x = 0;
			let w = 0;
			let wr = 0;
      let l = 0;

			const mouseDownHandler = function (e) {
        let cssText = document.body.style.cssText;
				document.body.style.cssText = cssText + "cursor: col-resize !important;";

				// Add HandlingResizer class
				resizer.classList.add('HandlingResizer');

        // Get the current mouse position
        x = e.clientX;

        // Calculate the current width of column
        w = pane.getBoundingClientRect().width;
        wr = pane_r.getBoundingClientRect().width;

        // Calculate the curent left of resizer
        l = resizer.getBoundingClientRect().left - resizer.parentNode.getBoundingClientRect().left;

        // Attach listeners for document's events
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
			};

			const mouseMoveHandler = function (e) {
        // Determine how far the mouse has been moved
        let dx = e.clientX - x;
        let new_width = w + dx;
        let new_widthr = wr - dx;

				if (new_width < min_w) {
					new_widthr = w + wr - min_w;
					new_width = min_w;
          dx = new_width - w;
				}
				if (new_widthr < min_wr) {
					new_width = w + wr - min_wr;
					new_widthr = min_wr;
          dx = new_width - w;
				}

        // Update the width of column
        pane.style.width = `${new_width}px`;
        pane_r.style.width = `${new_widthr}px`;

        // Update resizer pos
        resizer.style.left = `${l + dx}px`
			};

			// When user releases the mouse, remove the existing event listeners
      const mouseUpHandler = function (e) {
				document.body.style.cursor = "";
				
				// Remove HandlingResizer class
				resizer.classList.remove('HandlingResizer');
				
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
      };

			resizer.addEventListener('mousedown', mouseDownHandler);
      handlers.push(mouseDownHandler);
		}
    return handlers
  }
  const unsetResizerEvents = (resizers, handlers) => {
    resizers.forEach((resizer, index) => {
      resizer.removeEventListener('mousedown', handlers[index]);
    })
  }
</script>

<div bind:this={split_pane_root}	class:SplitPaneRoot={true} style="--minWidth: {minWidth}">
  <slot />
</div>

<style>
	.SplitPaneRoot {
		display: flex;
		flex-direction: row;
    width: 100%;
    height: 100%;
    min-width: var(--minWidth);
    position:relative;
	}
	.SplitPaneRoot :global(.Resizer) {
		position: absolute;
		top: 0;
    width: 5px;
    cursor: col-resize;
    user-select: none;
    z-index: 999;
	}
	.SplitPaneRoot :global(.Resizer::before) {
		content: "";
		position: absolute;
		top: 0;
    left: 2px;
		width: 1px;
		height: 100%;
		background-color: rgba(128,128,128,0.5);
	}
	.SplitPaneRoot :global(.HandlingResizer), .SplitPaneRoot :global(.Resizer:hover) {
		background-color: var(--theme-color-Accent-light);
	}
</style>