import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  UnsavedChangesProvider,
  useAllowNavigation,
  useUnsavedChanges,
} from '../src/lib/useUnsavedChanges';

function Editor() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const allowNavigation = useAllowNavigation();
  useUnsavedChanges(value !== '');
  return (
    <>
      <label>
        Nota
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button
        type="button"
        onClick={() => {
          allowNavigation();
          void navigate('/destino');
        }}
      >
        Guardar y abrir
      </button>
    </>
  );
}
function setup() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <UnsavedChangesProvider>
            <Link to="/destino">Ir a otra página</Link>
            <Outlet />
          </UnsavedChangesProvider>
        ),
        children: [
          { path: '/', element: <Editor /> },
          { path: '/destino', element: <h1>Destino</h1> },
        ],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(cleanup);

it('un formulario intacto navega sin preguntar', () => {
  const router = setup();
  fireEvent.click(screen.getByRole('link', { name: 'Ir a otra página' }));
  expect(router.state.location.pathname).toBe('/destino');
});

it('con cambios pendientes la navegación se detiene hasta confirmar en la página', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  const router = setup();
  fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Sin guardar' } });
  fireEvent.click(screen.getByRole('link', { name: 'Ir a otra página' }));
  expect(router.state.location.pathname).toBe('/');
  expect(await screen.findByRole('heading', { name: 'Cambios sin guardar' })).toBeVisible();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
  expect(router.state.location.pathname).toBe('/');
  expect(screen.getByLabelText('Nota')).toHaveValue('Sin guardar');
  expect(screen.queryByRole('heading', { name: 'Cambios sin guardar' })).toBeNull();

  fireEvent.click(screen.getByRole('link', { name: 'Ir a otra página' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(router.state.location.pathname).toBe('/destino');
  confirm.mockRestore();
});

it('avisa al recargar o cerrar la pestaña solo mientras hay cambios', () => {
  setup();
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Sin guardar' } });
  const dirty = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});

it('un guardado confirmado puede navegar antes de que el formulario se marque limpio', () => {
  const router = setup();
  fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Guardado' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y abrir' }));
  expect(router.state.location.pathname).toBe('/destino');
});
