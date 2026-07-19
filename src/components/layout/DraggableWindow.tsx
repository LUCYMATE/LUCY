import React, { useEffect, useRef } from 'react';

interface DraggableWindowProps {
  children: React.ReactNode;
  defaultPosition?: { x: number; y: number };
  defaultSize?: { width: number | string; height: number | string };
  minWidth?: number;
  minHeight?: number;
  dragHandleClass?: string;
  cancelClass?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function DraggableWindow({
  children,
  defaultPosition = { x: 0, y: 0 },
  defaultSize = { width: 400, height: 600 },
  minWidth = 300,
  minHeight = 400,
  dragHandleClass = 'drag-handle',
  cancelClass = 'cancel-drag',
  className = '',
  style = {}
}: DraggableWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let startTranslateX = defaultPosition.x;
    let startTranslateY = defaultPosition.y;
    
    // Set initial position
    container.style.transform = `translate(${defaultPosition.x}px, ${defaultPosition.y}px)`;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if clicking on drag handle
      if (!target.closest(`.${dragHandleClass}`)) return;
      
      // Check if clicking on cancelled elements (buttons, inputs, etc or specific cancel class)
      if (target.closest(`.${cancelClass}, button, input, textarea, select`)) return;

      e.preventDefault(); // Prevent text selection
      
      isDragging = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      
      // Parse current transform
      const computed = window.getComputedStyle(container);
      const matrix = new DOMMatrix(computed.transform === 'none' ? undefined : computed.transform);
      startTranslateX = matrix.m41;
      startTranslateY = matrix.m42;
      
      document.body.style.userSelect = 'none';
      container.style.transition = 'none'; // Ensure no transition delays drag
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      
      const newX = startTranslateX + dx;
      const newY = startTranslateY + dy;
      
      container.style.transform = `translate(${newX}px, ${newY}px)`;
    };

    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    };

    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragHandleClass, cancelClass]);

  return (
    <div
      ref={containerRef}
      className={`absolute ${className}`}
      style={{
        width: defaultSize.width,
        height: defaultSize.height,
        minWidth,
        minHeight,
        willChange: 'transform',
        ...style
      }}
    >
      {children}
    </div>
  );
}
