import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PasswordPage from '../src/features/auth/PasswordPage';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  auth: { recovering: false, endRecovery: vi.fn() },
}));
vi.mock('../src/lib/supabase', () => {
  const client = {
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  };
  return { supabase: client, requireSupabase: () => client };
});
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    profile: { display_name: 'Dueña de prueba' },
    online: true,
    signOut: vi.fn(),
    recovering: mocks.auth.recovering,
    endRecovery: mocks.auth.endRecovery,
  }),
}));

beforeEach(() => {
  mocks.auth.recovering = false;
  mocks.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { email: 'duena@example.test' } }, error: null });
  mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  mocks.updateUser.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

function fill(current: string | null, next = 'una frase larga y nueva') {
  if (current !== null)
    fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Repetir nueva contraseña'), { target: { value: next } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

it('requires the current password before changing it', async () => {
  render(<PasswordPage />);
  fill('');
  expect(await screen.findByRole('alert')).toHaveTextContent('contraseña actual');
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it('rejects a wrong current password without updating', async () => {
  mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
  render(<PasswordPage />);
  fill('incorrecta');
  expect(await screen.findByRole('alert')).toHaveTextContent('no es correcta');
  expect(mocks.signInWithPassword).toHaveBeenCalledWith({
    email: 'duena@example.test',
    password: 'incorrecta',
  });
  expect(mocks.updateUser).not.toHaveBeenCalled();
});

it('updates the password and revokes the other sessions', async () => {
  render(<PasswordPage />);
  fill('la contraseña anterior');
  await waitFor(() =>
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'una frase larga y nueva' }),
  );
  await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada');
});

it('skips the current password only in a recovery session', async () => {
  mocks.auth.recovering = true;
  render(<PasswordPage />);
  expect(screen.queryByLabelText('Contraseña actual')).toBeNull();
  fill(null);
  await waitFor(() => expect(mocks.updateUser).toHaveBeenCalled());
  expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  expect(mocks.auth.endRecovery).toHaveBeenCalled();
});
