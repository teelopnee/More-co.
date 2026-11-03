import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';

/**
 * Bottom sheet (dialog on wide screens). Pushes a history entry so the
 * Android back button / swipe-back closes the sheet instead of leaving the app.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const marker = { sheet: Math.random() };
    history.pushState(marker, '');
    let poppedByUs = false;
    const onPop = () => {
      poppedByUs = true;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (!poppedByUs && history.state && (history.state as { sheet?: number }).sheet === marker.sheet) history.back();
    };
  }, []);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            <IconClose />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

export function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="viewer" onClick={onClose} role="dialog" aria-label="รูปสลิป">
      <img src={src} alt="สลิป" />
    </div>
  );
}
