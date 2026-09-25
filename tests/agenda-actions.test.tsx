import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionButton } from '../src/components/ActionButton';
import AppointmentEditor from '../src/features/agenda/AppointmentEditor';
import type { Appointment } from '../src/lib/contracts';

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  useTypedQuery: vi.fn(),
  auth: { online: true },
}));
vi.mock('../src/lib/api', () => ({
  command: mocks.command,
  useTypedQuery: mocks.useTypedQuery,
  ApiError: class ApiError extends Error {},
}));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({
    online: mocks.auth.online,
    profile: { id: 'owner-id', role: 'owner', display_name: 'Dueña', active: true, version: 1 },
    bootstrap: {
      profiles: [{ id: 'owner-id', role: 'owner', display_name: 'Dueña', active: true }],
    },
  }),
}));
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
const clientsBySearch: Record<string, { id: string; name: string }[]> = {
  '': [{ id: 'client-a', name: 'Ana Ficticia' }],
  Bea: [{ id: 'client-b', name: 'Bea Ficticia' }],
};
beforeEach(() => {
  mocks.command.mockReset();
  mocks.auth.online = true;
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  mocks.useTypedQuery.mockImplementation((action: string, payload: { search?: string }) =>
    action === 'clients'
      ? { data: { items: clientsBySearch[payload.search ?? ''] ?? [] }, isFetching: false }
      : { data: { services: [] } },
  );
});
afterEach(cleanup);

describe('ActionButton', () => {
  it('avisa del éxito aunque el servidor confirme sin devolver datos', async () => {
    mocks.command.mockResolvedValue(null);
    const success = vi.fn();
    render(
      <ActionButton action="visit.close" payload={{ id: 'v' }} onSuccess={success}>
        Cerrar visita
      </ActionButton>,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar visita' }));
    await waitFor(() => expect(success).toHaveBeenCalledWith({}));
  });
  it('no avisa de éxito cuando la operación falla', async () => {
    mocks.command.mockRejectedValue(new Error('Rechazado'));
    const success = vi.fn();
    render(
      <ActionButton action="visit.close" payload={{ id: 'v' }} onSuccess={success}>
        Cerrar visita
      </ActionButton>,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar visita' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rechazado');
    expect(success).not.toHaveBeenCalled();
  });
  it('usa el estado de conexión de la sesión, no una lectura de navigator en el render', () => {
    mocks.auth.online = false;
    render(
      <ActionButton action="visit.close" payload={{}}>
        Cerrar visita
      </ActionButton>,
      { wrapper },
    );
    expect(screen.getByRole('button', { name: 'Cerrar visita' })).toBeDisabled();
  });
});

describe('Editor de citas', () => {
  it('valida el horario en línea sin alertas del navegador ni envío', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(<AppointmentEditor start="2026-09-24T10:00" onClose={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByLabelText(/^Clienta/), { target: { value: 'client-a' } });
    fireEvent.change(screen.getByLabelText(/^Final/), { target: { value: '2026-09-24T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cita' }));
    expect(await screen.findByText('La hora final debe ser posterior al inicio.')).toBeVisible();
    expect(screen.getByLabelText(/^Final/)).toHaveAttribute('aria-invalid', 'true');
    expect(alert).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
    alert.mockRestore();
  });
  it('exige clienta con un mensaje junto al campo', async () => {
    render(<AppointmentEditor start="2026-09-24T10:00" onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cita' }));
    expect(await screen.findByText('Selecciona una clienta.')).toBeVisible();
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('no ofrece estados que el servidor rechaza desde este formulario', () => {
    render(<AppointmentEditor start="2026-09-24T10:00" onClose={vi.fn()} />, { wrapper });
    const options = [...(screen.getByLabelText(/^Estado/) as HTMLSelectElement).options].map(
      (option) => option.value,
    );
    expect(options).toEqual(['scheduled', 'confirmed', 'cancelled', 'no_show']);
  });
  it('conserva la clienta elegida visible y seleccionada al cambiar la búsqueda', async () => {
    const close = vi.fn();
    mocks.command.mockResolvedValue({ id: 'appointment' });
    render(<AppointmentEditor start="2026-09-24T10:00" onClose={close} />, { wrapper });
    fireEvent.change(screen.getByLabelText(/^Clienta/), { target: { value: 'client-a' } });
    fireEvent.change(screen.getByLabelText('Buscar clienta'), { target: { value: 'Bea' } });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Bea Ficticia' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/^Clienta/)).toHaveValue('client-a');
    expect(screen.getByRole('option', { name: 'Ana Ficticia' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cita' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mocks.command.mock.calls[0][1]).toMatchObject({ client_id: 'client-a' });
  });
  it('mantiene el estado heredado de una cita en atención sin ofrecerlo a otras', () => {
    const appointment: Appointment = {
      id: 'a',
      version: 1,
      client_id: 'client-z',
      client_name: 'Zoe Ficticia',
      professional_id: 'owner-id',
      starts_at: '2026-09-24T15:00:00Z',
      ends_at: '2026-09-24T16:00:00Z',
      status: 'in_progress',
      notes: '',
      service_ids: [],
      visit_id: null,
    } as unknown as Appointment;
    render(<AppointmentEditor appointment={appointment} onClose={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText(/^Estado/)).toHaveValue('in_progress');
    expect(screen.getByLabelText(/^Clienta/)).toHaveValue('client-z');
  });
});
