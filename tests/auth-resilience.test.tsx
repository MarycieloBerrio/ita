import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { getOperationActor, setOperationActor } from '../src/lib/pendingOperations';
import { command, queryClient } from '../src/lib/api';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => {
  const client = {
    auth: {
      getUser: mocks.getUser,
      signOut: mocks.signOut,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }),
    },
    rpc: mocks.rpc,
  };
  return { supabase: client, requireSupabase: () => client };
});
const profile = {
  id: 'owner-fictitious',
  display_name: 'Dueña de prueba',
  role: 'owner',
  active: true,
  version: 1,
};
function Draft() {
  const [value, setValue] = useState('');
  return <input aria-label="Borrador" value={value} onChange={(e) => setValue(e.target.value)} />;
}
function Screen() {
  const auth = useAuth();
  return (
    <>
      <span>{auth.loading ? 'Cargando' : (auth.profile?.display_name ?? 'Sin acceso')}</span>
      <span role="status">{auth.error}</span>
      {auth.profile && <Draft />}
      <button onClick={() => void auth.refresh()}>Comprobar</button>
    </>
  );
}
beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: profile.id } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { profile }, error: null });
  setOperationActor(null);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  setOperationActor(null);
});
async function openDraft() {
  render(
    <AuthProvider>
      <Screen />
    </AuthProvider>,
  );
  await screen.findByText(profile.display_name);
  fireEvent.change(screen.getByRole('textbox', { name: 'Borrador' }), {
    target: { value: 'Fórmula escrita sin guardar' },
  });
}
it('el primer acceso sin sesión muestra el formulario sin un error técnico', async () => {
  mocks.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' }),
  });
  render(
    <AuthProvider>
      <Screen />
    </AuthProvider>,
  );
  await screen.findByText('Sin acceso');
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(getOperationActor()).toBeNull();
});
it('un error transitorio de Auth conserva el perfil y no desmonta el borrador', async () => {
  await openDraft();
  mocks.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: Object.assign(new Error('Conexión interrumpida'), {
      name: 'AuthRetryableFetchError',
      status: 503,
    }),
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
  });
  expect(screen.getByRole('textbox')).toHaveValue('Fórmula escrita sin guardar');
  expect(getOperationActor()).toBe(profile.id);
  expect(screen.getByRole('status')).toHaveTextContent('Conexión interrumpida');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
  });
  expect(screen.getByRole('textbox')).toHaveValue('Fórmula escrita sin guardar');
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});
it('un fallo de conexión de bootstrap conserva el editor; una cuenta inactiva lo retira', async () => {
  await openDraft();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch', code: '' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
  });
  expect(screen.getByRole('textbox')).toHaveValue('Fórmula escrita sin guardar');
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: 'Cuenta inactiva', code: '42501' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
  });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(getOperationActor()).toBeNull();
});
it('un JWT rechazado retira el perfil y las consultas previas', async () => {
  await openDraft();
  queryClient.setQueryData(['private-owner-data'], { amount: 9000 });
  mocks.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: Object.assign(new Error('Token inválido'), { status: 401 }),
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar' }));
  });
  await waitFor(() => expect(screen.getByText('Sin acceso')).toBeInTheDocument());
  expect(queryClient.getQueryData(['private-owner-data'])).toBeUndefined();
  expect(getOperationActor()).toBeNull();
});
it('avisa antes de cerrar la pestaña cuando una respuesta de escritura es incierta', async () => {
  await openDraft();
  mocks.rpc.mockRejectedValueOnce(new Error('Respuesta perdida'));
  await expect(command('payment.record', { amount: 1000 })).rejects.toThrow('Respuesta perdida');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
