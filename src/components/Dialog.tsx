import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
/** Native modal gives focus trapping, Escape and focus restoration on touch/keyboard devices. */
export default function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const changed = useRef(false);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      className="native-dialog"
      ref={ref}
      aria-label={title}
      onChange={() => {
        changed.current = true;
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (
          !changed.current ||
          window.confirm('Hay cambios sin confirmar. ¿Cerrar este formulario?')
        )
          onClose();
      }}
    >
      <div className="dialog-card">{children}</div>
    </dialog>
  );
}
