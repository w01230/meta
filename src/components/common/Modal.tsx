import React, { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  ariaLabel?: string;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '560px',
  ariaLabel,
  className
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Keep the latest onClose in a ref so focus initialization and key handling
  // never re-run just because the parent recreated its close handler.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 1. Capture launcher element when modal opens
  useEffect(() => {
    if (isOpen) {
      launcherRef.current = (document.activeElement as HTMLElement) || null;
    }
  }, [isOpen]);

  // 2. Return focus to launcher on close with sane fallback
  useEffect(() => {
    if (!isOpen && launcherRef.current) {
      if (document.body.contains(launcherRef.current) && typeof launcherRef.current.focus === 'function') {
        launcherRef.current.focus();
      }
      launcherRef.current = null;
    }
  }, [isOpen]);

  // 3. Background scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // 4. Initial focus, Escape key handling, and Focus Trap
  useEffect(() => {
    if (!isOpen) return;

    // Focus first interactive element or modal container
    const focusTimer = setTimeout(() => {
      if (modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          modalRef.current.focus();
        }
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusables = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null); // visible elements only

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className={['modal-container', className].filter(Boolean).join(' ')}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel || title}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h3 id={titleId} className="modal-title">{title}</h3>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="btn-circle-action size-sm modal-close-btn"
            onClick={onClose}
            aria-label="关闭对话框"
            data-tooltip="关闭对话框"
          >
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};
