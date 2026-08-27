// The gutters between panes, and the sizes they drag.
//
// The hook lives beside the handle because neither is any use alone: the layout
// owns a pixel size, the handle reports how far the pointer moved, and the two
// spellings of "which way is bigger" stay in one file.
import { useCallback, useRef, useState } from 'react';

type Axis = 'x' | 'y';

// Past this much of the window a pane is squeezing its neighbours to nothing,
// which no drag is ever asking for.
const MOST = 0.75;

/**
 * A pane size in pixels, and the drag that changes it.
 *
 * The cap is read off the window at drag time rather than fixed, so a layout
 * that fits a wide screen cannot be dragged into an unusable one on a small.
 */
export function usePaneSize(axis: Axis, initial: number, min: number): [number, (delta: number) => void] {
  const [size, setSize] = useState(initial);
  const drag = useCallback((delta: number) => {
    setSize((current) => {
      const room = (axis === 'x' ? window.innerWidth : window.innerHeight) * MOST;
      return Math.max(min, Math.min(current + delta, room));
    });
  }, [axis, min]);
  return [size, drag];
}

/**
 * The handle between two panes. Sits in a grid track of its own and draws a
 * hairline down the middle of it, so the gutter is a few pixels of hit area
 * rather than a line nobody can catch.
 */
export function Splitter({ axis, onDrag }: { axis: Axis; onDrag: (delta: number) => void }) {
  const from = useRef(0);

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      // Pointer capture is what keeps a drag alive once the cursor leaves the
      // few pixels it started in — without it the pane stops following as soon
      // as it falls behind the mouse.
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        from.current = axis === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const now = axis === 'x' ? e.clientX : e.clientY;
        onDrag(now - from.current);
        from.current = now;
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      className={`group flex touch-none items-center justify-center ${
        axis === 'x' ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
    >
      <div
        className={`rounded-full bg-zinc-800 transition group-hover:bg-zinc-600 ${
          axis === 'x' ? 'h-full w-px' : 'h-px w-full'
        }`}
      />
    </div>
  );
}
