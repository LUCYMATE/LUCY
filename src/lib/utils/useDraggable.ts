import { useState, useRef, useEffect, RefObject } from 'react';

export function useDraggable(
  handleRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>
) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const onPointerDown = (e: PointerEvent) => {
      // Don't drag if clicking a button or input
      if ((e.target as HTMLElement).tagName.toLowerCase() === 'button' || 
          (e.target as HTMLElement).tagName.toLowerCase() === 'input' ||
          (e.target as HTMLElement).closest('button')) {
        return;
      }
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      initialPos.current = { ...position };
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      
      setPosition({
        x: initialPos.current.x + dx,
        y: initialPos.current.y + dy,
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isDragging.current) {
        isDragging.current = false;
        handle.releasePointerCapture(e.pointerId);
      }
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);

    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };
  }, [handleRef, position]);

  return position;
}
