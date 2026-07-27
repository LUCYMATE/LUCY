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

const HIT = 10;
const CORNER = 8;

function createHandles(container: HTMLElement, onResizeStart: (dir: string, e: MouseEvent) => void) {
  const dirs = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
  return dirs.map(dir => {
    const el = document.createElement('div');
    el.className = `resize-handle-${dir}`;
    el.style.position = 'absolute';
    el.style.zIndex = '50';
    el.style.cursor = `${dir}-resize`;

    if (dir === 'n') { el.style.top = '0'; el.style.left = `${HIT}px`; el.style.right = `${HIT}px`; el.style.height = `${HIT}px`; }
    else if (dir === 's') { el.style.bottom = '0'; el.style.left = `${HIT}px`; el.style.right = `${HIT}px`; el.style.height = `${HIT}px`; }
    else if (dir === 'w') { el.style.left = '0'; el.style.top = `${HIT}px`; el.style.bottom = `${HIT}px`; el.style.width = `${HIT}px`; }
    else if (dir === 'e') { el.style.right = '0'; el.style.top = `${HIT}px`; el.style.bottom = `${HIT}px`; el.style.width = `${HIT}px`; }
    else { el.style.width = `${CORNER}px`; el.style.height = `${CORNER}px`; if (dir.includes('n')) el.style.top = '-2px'; else el.style.bottom = '-2px'; if (dir.includes('w')) el.style.left = '-2px'; else el.style.right = '-2px'; }

    el.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); onResizeStart(dir, e); });
    container.appendChild(el);
    return el;
  });
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
  const stateRef = useRef({ posX: defaultPosition.x, posY: defaultPosition.y, width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isDragging = false;
    let isResizing = false;
    let resizeDir = '';
    let startX = 0, startY = 0;
    let startPosX = defaultPosition.x, startPosY = defaultPosition.y;
    let startW = 0, startH = 0;

    const initW = typeof defaultSize.width === 'number' ? defaultSize.width : parseInt(defaultSize.width);
    const initH = typeof defaultSize.height === 'number' ? defaultSize.height : parseInt(defaultSize.height);
    const s = stateRef.current;
    s.width = initW; s.height = initH;

    container.style.transform = `translate(${defaultPosition.x}px, ${defaultPosition.y}px)`;

    const clamp = (v: number, min: number) => Math.max(v, min);

    const onResizeStart = (dir: string, e: MouseEvent) => {
      isResizing = true;
      resizeDir = dir;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      startPosX = rect.left; startPosY = rect.top;
      startW = s.width; startH = s.height;
      container.style.transition = 'none';
      document.body.style.userSelect = 'none';
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${dragHandleClass}`)) return;
      if (target.closest(`.${cancelClass}, button, input, textarea, select`)) return;
      e.preventDefault();
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      const computed = window.getComputedStyle(container);
      const m = new DOMMatrix(computed.transform === 'none' ? undefined : computed.transform);
      startPosX = m.m41; startPosY = m.m42;
      document.body.style.userSelect = 'none';
      document.body.classList.add('is-dragging-window');
      container.style.transition = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newW = startW, newH = startH, newX = startPosX, newY = startPosY;
        if (resizeDir.includes('e')) newW = clamp(startW + dx, minWidth);
        if (resizeDir.includes('w')) { newW = clamp(startW - dx, minWidth); newX = startPosX + (startW - newW); }
        if (resizeDir.includes('s')) newH = clamp(startH + dy, minHeight);
        if (resizeDir.includes('n')) { newH = clamp(startH - dy, minHeight); newY = startPosY + (startH - newH); }
        container.style.width = `${newW}px`;
        container.style.height = `${newH}px`;
        container.style.transform = `translate(${newX}px, ${newY}px)`;
        s.width = newW; s.height = newH; s.posX = newX; s.posY = newY;
        return;
      }
      if (!isDragging) return;
      container.style.transform = `translate(${startPosX + e.clientX - startX}px, ${startPosY + e.clientY - startY}px)`;
    };

    const handleMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.userSelect = '';
        return;
      }
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
        document.body.classList.remove('is-dragging-window');
      }
    };

    const handles = createHandles(container, onResizeStart);
    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      handles.forEach(h => h.remove());
      container.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragHandleClass, cancelClass, minWidth, minHeight]);

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