import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ServiceEditor from '../src/features/visits/ServiceEditor';
import type { VisitService } from '../src/lib/contracts';
import { createTechnicalData } from '../src/features/technical/types';

const mocks = vi.hoisted(() => ({ command: vi.fn(), invalidate: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ profile: { role: 'owner' } }) }));
vi.mock('../src/lib/api', () => ({
  command: mocks.command,
  queryClient: { invalidateQueries: mocks.invalidate },
  ApiError: class ApiError extends Error {},
}));
const service: VisitService = {
  id: 'service-test',
  visit_id: 'visit-test',
  service_id: 'catalog-test',
  version: 1,
  group_id: null,
  name: 'General',
  path: 'Cabello',
  form_type: 'general',
  form_version: 1,
  price_mode: 'custom',
  reference_price: null,
  price: 30000,
  status: 'completed',
  technical: createTechnicalData('general'),
  completed_at: '2026-09-15T12:00:00Z',
};
beforeEach(() => {
  mocks.command.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);
async function startCorrection() {
  render(<ServiceEditor service={service} sales={[]} onDirty={vi.fn()} />);
  await screen.findByLabelText('Observaciones (opcional)');
  fireEvent.click(screen.getByRole('button', { name: 'Corregir ficha' }));
  expect(screen.getByRole('button', { name: 'Guardar ficha' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Motivo de la corrección/), {
    target: { value: 'Ajustar observaciones' },
  });
  fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), {
    target: { value: 'Corrección guardada' },
  });
}
it('cierra la corrección confirmada, bloquea los campos y permite iniciar otra con motivo nuevo', async () => {
  mocks.command.mockResolvedValue({ version: 2 });
  await startCorrection();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
  await screen.findByRole('button', { name: 'Corregir ficha' });
  expect(screen.queryByRole('button', { name: 'Guardar ficha' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Motivo de la corrección/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Observaciones (opcional)')).toBeDisabled();
  expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Corrección guardada');
  expect(screen.getByLabelText(/Precio de esta atención/)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Corregir ficha' }));
  expect(screen.getByLabelText(/Motivo de la corrección/)).toHaveValue('');
  expect(screen.getByLabelText('Observaciones (opcional)')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Guardar ficha' })).toBeDisabled();
});
it('mantiene la corrección tras un error y la cierra al confirmar el reintento', async () => {
  mocks.command
    .mockRejectedValueOnce(new Error('Respuesta perdida'))
    .mockResolvedValue({ version: 2 });
  await startCorrection();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
  const retry = await screen.findByRole('button', { name: 'Reintentar guardado' });
  expect(screen.getByLabelText('Observaciones (opcional)')).toBeEnabled();
  fireEvent.click(retry);
  await screen.findByRole('button', { name: 'Corregir ficha' });
  expect(mocks.command.mock.calls[1]).toEqual(mocks.command.mock.calls[0]);
});
it('no cierra ni pierde cambios hechos mientras se confirma el guardado anterior', async () => {
  let resolve!: (value: { version: number }) => void;
  mocks.command
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue({ version: 3 });
  await startCorrection();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
  fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), {
    target: { value: 'Cambio posterior' },
  });
  await act(async () => resolve({ version: 2 }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar ficha' })).toBeEnabled());
  expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Cambio posterior');
  expect(screen.getByLabelText('Observaciones (opcional)')).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Corregir ficha' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar ficha' }));
  await screen.findByRole('button', { name: 'Corregir ficha' });
  expect(mocks.command.mock.calls[1][1]).toMatchObject({
    version: 2,
    technical: { notes: 'Cambio posterior' },
  });
});
