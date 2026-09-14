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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, command } from '../src/lib/api';
import { useOperation } from '../src/features/catalog/operations';
import { PriceCell } from '../src/features/catalog/CatalogPage';
import type { Service } from '../src/lib/contracts';

vi.mock('../src/lib/api', () => ({
  command: vi.fn(),
  useAppQuery: vi.fn(),
  ApiError: class extends Error {
    constructor(
      message: string,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
const request = vi.mocked(command);
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('Confirmación de operaciones', () => {
  it('mantiene clave en una respuesta incierta y bloquea cambios del importe hasta reintentar', async () => {
    request
      .mockRejectedValueOnce(new ApiError('Conexión interrumpida', '08006'))
      .mockResolvedValue({ id: 'confirmed' });
    const { result } = renderHook(useOperation, { wrapper });
    await act(async () => {
      await result.current.run('payment.record', { amount: 100000 });
    });
    const key = request.mock.calls[0][2];
    await act(async () => {
      await result.current.run('payment.record', { amount: 130000 });
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain('confirmación incierta');
    await act(async () => {
      await result.current.run('payment.record', { amount: 100000 });
    });
    expect(request.mock.calls[1][2]).toBe(key);
    expect(result.current.success).toBe('Guardado confirmado');
  });
  it('admite corregir datos después de un rechazo transaccional definitivo', async () => {
    request
      .mockRejectedValueOnce(new ApiError('Saldo insuficiente', 'P0001'))
      .mockResolvedValue({ id: 'ok' });
    const { result } = renderHook(useOperation, { wrapper });
    await act(async () => {
      await result.current.run('payment.record', { amount: 250000 });
    });
    await act(async () => {
      await result.current.run('payment.record', { amount: 230000 });
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][2]).not.toBe(request.mock.calls[1][2]);
  });
  it('bloquea doble toque y conserva los datos originales aunque el objeto llamante mute', async () => {
    let reject: (error: Error) => void = () => undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    const { result } = renderHook(useOperation, { wrapper });
    const payload = { quantity: 1 };
    let first: Promise<unknown>;
    act(() => {
      first = result.current.run('inventory.move', payload);
    });
    payload.quantity = 2;
    await act(async () => {
      await result.current.run('inventory.move', payload);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ quantity: 1 });
    await act(async () => {
      reject(new Error('sin respuesta'));
      await first;
    });
  });
  it('sin Internet no envía pagos ni muestra guardado confirmado', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(useOperation, { wrapper });
    await act(async () => {
      await result.current.run('payment.record', { amount: 1 });
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.current.success).toBe('');
    expect(result.current.error).toContain('Sin conexión');
  });
});

it('una tarifa editada no pierde lo escrito ni adopta una versión concurrente sin revisar', async () => {
  const service: Service = {
    id: 'service-id',
    version: 1,
    name: 'Cepillado',
    path: 'Cabello / Cepillado',
    category_id: 'category-id',
    form_type: 'general',
    price_mode: 'fixed',
    fixed_price: 30000,
    duration_minutes: 30,
    active: true,
    sort_order: 0,
  };
  request.mockRejectedValueOnce(new ApiError('Otra sesión modificó la tarifa', 'P0001'));
  const { rerender } = render(<PriceCell service={service} owner />, { wrapper });
  fireEvent.change(screen.getByRole('textbox', { name: 'Tarifa de Cepillado' }), {
    target: { value: '35000' },
  });
  rerender(<PriceCell service={{ ...service, version: 2, fixed_price: 32000 }} owner />);
  expect(screen.getByRole('textbox', { name: 'Tarifa de Cepillado' })).toHaveValue('35000');
  expect(screen.getByRole('alert')).toHaveTextContent('Otra sesión cambió esta tarifa');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(request.mock.calls[0][1]).toMatchObject({ version: 1, fixed_price: 35000 });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Descartar edición y cargar tarifa vigente' }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Descartar edición y cargar tarifa vigente' }),
  );
  expect(screen.getByRole('textbox', { name: 'Tarifa de Cepillado' })).toHaveValue('32000');
});
