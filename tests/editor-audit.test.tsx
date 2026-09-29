import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EditorForm from '../src/components/EditorForm';
import Dialog from '../src/components/Dialog';
import Profiles from '../src/features/settings/Profiles';
import { useOperation } from '../src/features/catalog/operations';
import { useOperation as useWorkOperation } from '../src/lib/useOperation';
import type { Profile } from '../src/lib/contracts';

const mocks = vi.hoisted(() => ({ command: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock('../src/lib/api', () => ({
  command: mocks.command,
  queryClient: { invalidateQueries: mocks.invalidateQueries },
  ApiError: class ApiError extends Error {},
}));
const profile: Profile = {
  id: 'profile-test',
  version: 1,
  display_name: 'Original',
  role: 'worker',
  active: true,
};
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.command.mockReset();
  mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('cancelar pide confirmación y conserva el formulario cuando se rechaza', () => {
  const close = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { rerender } = render(
    <EditorForm busy={false} dirty>
      <input aria-label="Dato" defaultValue="Pendiente" />
      <button type="button" data-editor-close onClick={close}>
        Cancelar
      </button>
    </EditorForm>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Dato')).toHaveValue('Pendiente');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(close).toHaveBeenCalledOnce();
  rerender(
    <EditorForm busy dirty>
      <input aria-label="Dato" />
      <button data-editor-close onClick={close}>
        Cancelar
      </button>
    </EditorForm>,
  );
  expect(screen.getByLabelText('Dato')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
});
it('Escape no cierra un guardado pendiente y un formulario intacto cierra sin falsas advertencias', () => {
  const close = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const content = (busy: boolean, dirty: boolean) => (
    <Dialog title="Editor" onClose={close}>
      <EditorForm busy={busy} dirty={dirty}>
        <input aria-label="Dato" />
      </EditorForm>
    </Dialog>
  );
  const { rerender, container } = render(content(true, true));
  const dialog = container.querySelector('dialog')!;
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  rerender(content(false, true));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  // The question is asked inside the dialog, never with window.confirm.
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('cambios sin confirmar');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  rerender(content(false, false));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});
it('los botones de cierre internos pasan por la misma confirmación y el diálogo usa su encabezado', () => {
  const close = vi.fn();
  const inner = vi.fn();
  render(
    <Dialog title="Respaldo" onClose={close}>
      <EditorForm busy={false} dirty>
        <h2>Nueva cita</h2>
        <button type="button" data-editor-close onClick={inner}>
          Cancelar
        </button>
      </EditorForm>
    </Dialog>,
  );
  const dialog = document.querySelector('dialog')!;
  expect(dialog).toHaveAttribute(
    'aria-labelledby',
    screen.getByRole('heading', { name: 'Nueva cita' }).id,
  );
  expect(dialog).not.toHaveAttribute('aria-label');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(inner).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Descartar y cerrar' }));
  expect(close).toHaveBeenCalledOnce();
});
it('un intento sin conexión borra la confirmación de la operación anterior en ambos hooks', async () => {
  mocks.command.mockResolvedValue({ id: 'ok' });
  const catalog = renderHook(useOperation, { wrapper });
  const work = renderHook(useWorkOperation, { wrapper });
  await act(async () => {
    await catalog.result.current.run('service.save', {});
    await work.result.current.run('visit.save', {});
  });
  expect(catalog.result.current.success).toBeTruthy();
  expect(work.result.current.saved).toBe(true);
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await act(async () => {
    await catalog.result.current.run('service.save', {});
    await work.result.current.run('visit.save', {});
  });
  expect(catalog.result.current.success).toBe('');
  expect(work.result.current.saved).toBe(false);
  expect(mocks.command).toHaveBeenCalledTimes(2);
});
it('perfil conserva la edición cuando se actualiza remotamente y usa la versión inicial', async () => {
  mocks.command.mockRejectedValue(new Error('Conflicto de versión'));
  const { rerender } = render(<Profiles profiles={[profile]} />, { wrapper });
  fireEvent.change(screen.getByLabelText('Nombre visible'), { target: { value: 'Edición local' } });
  rerender(<Profiles profiles={[{ ...profile, version: 2, display_name: 'Edición remota' }]} />);
  expect(screen.getByLabelText('Nombre visible')).toHaveValue('Edición local');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }));
  await waitFor(() => expect(mocks.command).toHaveBeenCalled());
  expect(mocks.command.mock.calls[0][1]).toMatchObject({
    version: 1,
    display_name: 'Edición local',
  });
});
