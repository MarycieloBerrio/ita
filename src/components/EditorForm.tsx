import type { ComponentProps } from 'react';

/** Keep submitted values stable until their confirmation closes or resets the editor. */
export default function EditorForm({
  busy,
  dirty,
  children,
  ...props
}: ComponentProps<'form'> & { busy: boolean; dirty: boolean }) {
  return (
    <form
      {...props}
      aria-busy={busy}
      data-editor-dirty={dirty}
      onClickCapture={(event) => {
        if (!(event.target as Element).closest('[data-editor-close]')) return;
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
