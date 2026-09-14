import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPendingOperation, command, queryClient, retryPendingOperation } from '../src/lib/api';
import {
  findOperationRetry,
  getPendingOperations,
  setOperationActor,
} from '../src/lib/pendingOperations';
import { useOperation as useSharedOperation } from '../src/lib/useOperation';
import { useOperation as useCatalogOperation } from '../src/features/catalog/operations';
import { PendingOperationsBanner } from '../src/components/PendingOperationsBanner';
import { useTechnicalDraft } from '../src/features/visits/useTechnicalDraft';
import { createTechnicalData } from '../src/features/technical/types';
import type { VisitService } from '../src/lib/contracts';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ requireSupabase: () => ({ rpc: mocks.rpc }) }));
const payload = { amount: 100000, account_id: 'fictitious-account' };
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mocks.rpc.mockReset();
  setOperationActor(crypto.randomUUID());
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  setOperationActor(null);
  vi.useRealTimers();
});

type OperationHook = () => {
  run: (action: string, payload: Record<string, unknown>) => Promise<unknown>;
};
const operationHooks: [string, OperationHook][] = [
  ['general', useSharedOperation],
  ['catálogo', useCatalogOperation],
];
describe.each(operationHooks)('Recuperación del formulario %s', (_name, useOperation) => {
  it('conserva el UUID tras desmontar el editor y no duplica el pago al reintentar', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Lost response', code: '08006' } })
      .mockResolvedValueOnce({ data: { id: 'confirmed' }, error: null });
    const first = renderHook(useOperation, { wrapper });
    await act(async () => {
      await first.result.current.run('payment.record', payload);
    });
    const original = mocks.rpc.mock.calls[0][1];
    first.unmount();
    const second = renderHook(useOperation, { wrapper });
    await act(async () => {
      await second.result.current.run('payment.record', payload);
    });
    expect(mocks.rpc.mock.calls[1][1]).toEqual(original);
    expect(getPendingOperations()).toHaveLength(0);
  });
  it('permite nuevos datos después de resolver desde el aviso global sin repetir el pago anterior', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'Lost response' } })
      .mockResolvedValueOnce({ data: { result: { id: 'confirmed' } }, error: null })
      .mockResolvedValueOnce({ data: { id: 'second-payment' }, error: null });
    const hook = renderHook(useOperation, { wrapper });
    await act(async () => {
      await hook.result.current.run('payment.record', payload);
    });
    const id = mocks.rpc.mock.calls[0][1].p_operation_id as string;
    await act(async () => {
      expect(await checkPendingOperation(id)).toBe(true);
    });
    await act(async () => {
      await hook.result.current.run('payment.record', { ...payload, amount: 20000 });
    });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'app_command')).toHaveLength(2);
    expect(mocks.rpc.mock.calls[2][1].p_operation_id).not.toBe(id);
  });
});

it('bloquea otros formularios hasta resolver la incertidumbre y preserva el payload original', async () => {
  mocks.rpc
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValue({ data: { id: 'ok' }, error: null });
  const original = structuredClone(payload);
  const id = crypto.randomUUID();
  await expect(command('payment.record', original, id)).rejects.toThrow('fetch');
  original.amount = 900000;
  await expect(command('inventory.move', { quantity: 1 })).rejects.toMatchObject({
    code: 'OPERATION_PENDING',
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  await retryPendingOperation(id);
  expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_payload: payload, p_operation_id: id });
});
it('dos solicitudes simultáneas con respuesta perdida pueden recuperarse por separado', async () => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  mocks.rpc
    .mockRejectedValueOnce(new Error('Primera respuesta perdida'))
    .mockRejectedValueOnce(new Error('Segunda respuesta perdida'))
    .mockResolvedValue({ data: { id: 'confirmed' }, error: null });
  await Promise.allSettled([
    command('payment.record', payload, first),
    command('inventory.move', { quantity: 1 }, second),
  ]);
  expect(getPendingOperations()).toHaveLength(2);
  await retryPendingOperation(first);
  await retryPendingOperation(second);
  expect(getPendingOperations()).toHaveLength(0);
  expect(mocks.rpc.mock.calls.slice(2).map(([, args]) => args.p_operation_id)).toEqual([
    first,
    second,
  ]);
});

it('cada cuenta recupera únicamente sus propias operaciones, incluso tras cerrar y abrir sesión', async () => {
  const owner = crypto.randomUUID();
  const worker = crypto.randomUUID();
  const id = crypto.randomUUID();
  setOperationActor(owner);
  mocks.rpc
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue({ data: { id: 'worker-write' }, error: null });
  await expect(command('payment.record', payload, id)).rejects.toThrow('network');
  setOperationActor(null);
  await expect(command('payment.record', payload)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  setOperationActor(worker);
  expect(getPendingOperations()).toHaveLength(0);
  expect(findOperationRetry('payment.record', payload)).toBeUndefined();
  expect(await checkPendingOperation(id)).toBe(false);
  await command('payment.record', payload);
  setOperationActor(owner);
  expect(getPendingOperations()[0].id).toBe(id);
});

it('una comprobación sin resultado no descarta el UUID; el reintento requiere un clic y no se ejecuta sin Internet', async () => {
  const id = crypto.randomUUID();
  mocks.rpc
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: { id: 'ok' }, error: null })
    .mockResolvedValueOnce({ data: { result: { id: 'ok' } }, error: null });
  await expect(command('payment.record', payload, id)).rejects.toThrow();
  const view = render(<PendingOperationsBanner online />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar resultado' }));
  });
  expect(getPendingOperations()[0].id).toBe(id);
  expect(screen.getByRole('status')).toHaveTextContent('Aún no aparece');
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  view.rerender(<PendingOperationsBanner online={false} />);
  expect(screen.getByRole('button', { name: 'Reintentar confirmación' })).toBeDisabled();
  await expect(retryPendingOperation(id)).rejects.toThrow('Sin conexión');
  window.dispatchEvent(new Event('online'));
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  view.rerender(<PendingOperationsBanner online />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar confirmación' }));
  });
  expect(mocks.rpc.mock.calls[2][1].p_operation_id).toBe(id);
  expect(screen.getByRole('status')).toHaveTextContent('Guardado confirmado');
  // A remounted stale form consumes the recovered result instead of creating another payment.
  const hook = renderHook(useSharedOperation, { wrapper });
  await act(async () => {
    expect(await hook.result.current.run('payment.record', payload)).toEqual({ id: 'ok' });
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(4);
  expect(mocks.rpc.mock.calls[3][0]).toBe('app_query');
});

it('un rechazo SQL definitivo permite corregir los datos sin bloquear nuevos formularios', async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: null, error: { message: 'Sobrepago', code: 'P0001' } })
    .mockResolvedValue({ data: { id: 'ok' }, error: null });
  await expect(command('payment.record', payload)).rejects.toMatchObject({ code: 'P0001' });
  expect(getPendingOperations()).toHaveLength(0);
  await command('payment.record', { ...payload, amount: 2000 });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it('un resultado confirmado vuelve a comprobar permisos sin repetir la escritura', async () => {
  const id = crypto.randomUUID();
  mocks.rpc.mockResolvedValueOnce({ data: { id: 'ok' }, error: null }).mockResolvedValueOnce({
    data: null,
    error: { message: 'Atención reasignada', code: '42501' },
  });
  await command('payment.record', payload, id);
  await expect(command('payment.record', payload, id)).rejects.toMatchObject({ code: '42501' });
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['app_command', 'app_query']);
});

const service: VisitService = {
  id: 'service-fictitious',
  version: 1,
  visit_id: 'visit-fictitious',
  service_id: 'catalog-fictitious',
  group_id: null,
  name: 'General',
  path: 'Cabello',
  form_type: 'general',
  form_version: 1,
  price_mode: 'custom',
  reference_price: null,
  price: null,
  status: 'draft',
  technical: createTechnicalData('general'),
  completed_at: null,
};
it('la ficha adopta el guardado resuelto por el aviso sin perder ni enviar automáticamente las ediciones posteriores', async () => {
  vi.useFakeTimers();
  mocks.rpc
    .mockRejectedValueOnce(new Error('Respuesta perdida'))
    .mockResolvedValueOnce({ data: { result: { version: 2 } }, error: null })
    .mockResolvedValueOnce({ data: { version: 3 }, error: null });
  const hook = renderHook(() => useTechnicalDraft(service));
  act(() => hook.result.current.setDraft((draft) => ({ ...draft, price: '100000' })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1300);
  });
  act(() => hook.result.current.setDraft((draft) => ({ ...draft, price: '120000' })));
  const id = mocks.rpc.mock.calls[0][1].p_operation_id as string;
  await act(async () => {
    await checkPendingOperation(id);
  });
  expect(hook.result.current.version).toBe(2);
  expect(hook.result.current.draft.price).toBe('120000');
  expect(hook.result.current.dirty).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  await act(async () => {
    await hook.result.current.save();
  });
  expect(mocks.rpc.mock.calls[2][1].p_payload).toMatchObject({ version: 2, price: 120000 });
  expect(hook.result.current.dirty).toBe(false);
});

it('un guardado bloqueado por otra operación no retiene datos obsoletos al reintentar la ficha', async () => {
  vi.useFakeTimers();
  mocks.rpc
    .mockRejectedValueOnce(new Error('Respuesta de pago perdida'))
    .mockResolvedValueOnce({ data: { result: { id: 'payment-confirmed' } }, error: null })
    .mockResolvedValueOnce({ data: { version: 2 }, error: null });
  const paymentId = crypto.randomUUID();
  await expect(command('payment.record', payload, paymentId)).rejects.toThrow();
  const hook = renderHook(() => useTechnicalDraft(service));
  act(() => hook.result.current.setDraft((draft) => ({ ...draft, price: '100000' })));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1300);
  });
  expect(hook.result.current.error).toContain('confirmación incierta');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.setDraft((draft) => ({ ...draft, price: '120000' })));
  await act(async () => {
    await checkPendingOperation(paymentId);
  });
  await act(async () => {
    await hook.result.current.save();
  });
  expect(mocks.rpc.mock.calls[2][1].p_payload).toMatchObject({ price: 120000 });
});
