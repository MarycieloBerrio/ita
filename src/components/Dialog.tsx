import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface DialogControls {
  /** Close through the same busy/dirty checks as Escape. */
  requestClose: () => void;
}
const DialogContext = createContext<DialogControls | null>(null);
export const useDialog = () => useContext(DialogContext);

/**
 * Native modal gives focus trapping, Escape and focus restoration on touch/keyboard devices.
 * Every close path (Escape, `[data-editor-close]` buttons inside an EditorForm, or
 * `useDialog().requestClose`) is refused while a save is running and asks for an in-dialog
 * confirmation while an editor reports unsaved changes.
 */
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
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [labelledBy, setLabelledBy] = useState<string | null>(null);
  const fallbackId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    // Name the dialog after its visible heading; the title prop is only a fallback.
    const heading = ref.current?.querySelector<HTMLElement>('h1, h2, h3');
    if (!heading) return;
    if (!heading.id) heading.id = `${fallbackId}-title`;
    setLabelledBy(heading.id);
  }, [fallbackId]);
  useEffect(() => {
    if (confirming) keepEditing.current?.focus();
  }, [confirming]);
  const requestClose = useCallback(() => {
    const element = ref.current;
    if (element?.querySelector('[aria-busy="true"]')) return;
    const dirty = element?.querySelector('[data-editor-dirty="true"]');
    if (dirty) setConfirming(true);
    else onClose();
  }, [onClose]);
  return (
    <dialog
      className="native-dialog"
      ref={ref}
      aria-labelledby={labelledBy ?? undefined}
      aria-label={labelledBy ? undefined : title}
      onCancel={(e) => {
        e.preventDefault();
        if (confirming) setConfirming(false);
        else requestClose();
      }}
    >
      <DialogContext.Provider value={{ requestClose }}>
        <div className="dialog-card">
          {confirming && (
            <div className="notice stack" role="alert">
              <p>Hay cambios sin confirmar. ¿Cerrar este formulario y descartarlos?</p>
              <div className="actions">
                <button
                  ref={keepEditing}
                  type="button"
                  className="button-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Seguir editando
                </button>
                <button
                  type="button"
                  className="button-danger"
                  onClick={() => {
                    setConfirming(false);
                    onClose();
                  }}
                >
                  Descartar y cerrar
                </button>
              </div>
            </div>
          )}
          {children}
        </div>
      </DialogContext.Provider>
    </dialog>
  );
}
