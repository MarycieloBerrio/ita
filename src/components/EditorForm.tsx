import type { ComponentProps } from 'react';
import { useUnsavedChanges } from '../lib/useUnsavedChanges';
import { useDialog } from './Dialog';

/** Keep submitted values stable until their confirmation closes or resets the editor. */
export default function EditorForm({
  busy,
  dirty,
  children,
  ...props
}: ComponentProps<'form'> & { busy: boolean; dirty: boolean }) {
  const dialog = useDialog();
  useUnsavedChanges(dirty || busy);
  return (
    <form
      {...props}
      aria-busy={busy}
      data-editor-dirty={dirty}
      onClickCapture={(event) => {
        if (!(event.target as Element).closest('[data-editor-close]')) return;
        if (dialog) {
          // Inside a dialog, closing follows the dialog's own busy/dirty confirmation.
          event.preventDefault();
          event.stopPropagation();
          dialog.requestClose();
          return;
        }
        if (
          busy ||
          (dirty && !window.confirm('Hay cambios sin guardar. ¿Cerrar este formulario?'))
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <fieldset className="editor-fields" disabled={busy}>
        {children}
      </fieldset>
    </form>
  );
}
