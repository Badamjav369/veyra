import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { CloseIcon } from './Icons';

interface Props {
  title: string;
  labelId: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

/** Native <dialog>: focus is trapped, Esc closes, and the page behind becomes inert. */
export function Modal({ title, labelId, onClose, children, width = 460 }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={labelId}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__body">
        <header className="modal__header">
          <h2 id={labelId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
