import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  position: 'top' | 'bottom';
  visible: boolean;
}

export const TooltipProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeElRef = useRef<Element | null>(null);
  const tooltipId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    const active = activeElRef.current;
    if (active) {
      const describedBy = (active.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== tooltipId);
      if (describedBy.length) active.setAttribute('aria-describedby', describedBy.join(' '));
      else active.removeAttribute('aria-describedby');
    }
    activeElRef.current = null;
    setTooltip(null);
  }, [clearTimer, tooltipId]);

  const show = useCallback((el: Element) => {
    const text = el.getAttribute('data-tooltip');
    if (!text) return;
    if (activeElRef.current === el && timerRef.current === null) return;

    const previous = activeElRef.current;
    if (previous && previous !== el) {
      const ids = (previous.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== tooltipId);
      if (ids.length) previous.setAttribute('aria-describedby', ids.join(' '));
      else previous.removeAttribute('aria-describedby');
    }
    activeElRef.current = el;
    clearTimer();

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (activeElRef.current !== el) return;

      const rect = el.getBoundingClientRect();
      const GAP = 8;
      const TOOLTIP_EST_HEIGHT = 34;
      const hasRoomAbove = rect.top >= TOOLTIP_EST_HEIGHT + GAP + 8;
      const hasRoomBelow = window.innerHeight - rect.bottom >= TOOLTIP_EST_HEIGHT + GAP + 8;

      // Default: position above the element
      let x = rect.left + rect.width / 2;
      let y = rect.top - GAP;
      let position: 'top' | 'bottom' = 'top';

      // If not enough room above, flip to bottom
      if (!hasRoomAbove && hasRoomBelow) {
        y = rect.bottom + GAP;
        position = 'bottom';
      } else if (!hasRoomAbove && !hasRoomBelow) {
        y = Math.max(TOOLTIP_EST_HEIGHT + GAP, Math.min(rect.bottom + GAP, window.innerHeight - 8));
        position = rect.top > window.innerHeight / 2 ? 'top' : 'bottom';
      }

      const existingDescription = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      if (!existingDescription.includes(tooltipId)) {
        el.setAttribute('aria-describedby', [...existingDescription, tooltipId].join(' '));
      }
      setTooltip({ text, x, y, position, visible: true });
    }, 150);
  }, [clearTimer, tooltipId]);

  useEffect(() => {
    const handleIn = (e: Event) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const target = (e.target as Element)?.closest?.('[data-tooltip]');
      if (target) show(target);
    };

    const handleOut = (e: Event) => {
      const target = (e.target as Element)?.closest?.('[data-tooltip]');
      if (!target) return;
      if (e.type === 'pointerout') {
        const related = (e as PointerEvent).relatedTarget as Element | null;
        if (related && target.contains(related)) return;
      }
      // For focusout, check if focus moved within same tooltip element
      if (e.type === 'focusout') {
        const related = (e as FocusEvent).relatedTarget as Element | null;
        if (related?.closest?.('[data-tooltip]') === target) return;
      }
      if (activeElRef.current === target || !activeElRef.current) {
        hide();
      }
    };

    document.addEventListener('pointerover', handleIn, true);
    document.addEventListener('pointerout', handleOut, true);
    document.addEventListener('focusin', handleIn, true);
    document.addEventListener('focusout', handleOut, true);
    // Hide on scroll and resize for viewport correctness
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      document.removeEventListener('pointerover', handleIn, true);
      document.removeEventListener('pointerout', handleOut, true);
      document.removeEventListener('focusin', handleIn, true);
      document.removeEventListener('focusout', handleOut, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      clearTimer();
    };
  }, [show, hide, clearTimer]);

  // Adjust horizontal position after render to prevent viewport clipping
  useEffect(() => {
    if (!tooltip?.visible || !tooltipRef.current) return;
    const el = tooltipRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const MARGIN = 8;

    if (rect.right > vw - MARGIN) {
      el.style.transform = tooltip.position === 'top'
        ? `translateX(calc(-50% - ${rect.right - vw + MARGIN}px)) translateY(-100%)`
        : `translateX(calc(-50% - ${rect.right - vw + MARGIN}px))`;
    } else if (rect.left < MARGIN) {
      el.style.transform = tooltip.position === 'top'
        ? `translateX(calc(-50% + ${MARGIN - rect.left}px)) translateY(-100%)`
        : `translateX(calc(-50% + ${MARGIN - rect.left}px))`;
    }
  }, [tooltip]);

  return (
    <>
      {children}
      {tooltip?.visible && createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className={`custom-tooltip custom-tooltip--${tooltip.position}`}
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
          role="tooltip"
        >
          {tooltip.text}
        </div>,
        document.body
      )}
    </>
  );
};
