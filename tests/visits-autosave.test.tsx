import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTechnicalDraft } from '../src/features/visits/useTechnicalDraft';
import type { VisitService } from '../src/lib/contracts';
import { createTechnicalData } from '../src/features/technical/types';
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/api', () => ({
  command: mocks.command,
  queryClient: { invalidateQueries: mocks.invalidate },
  ApiError: class ApiError extends Error {
    code?: string;
  },
}));
const service: VisitService = {
  id: 's1',
  version: 1,
  visit_id: 'v1',
  service_id: 'catalog1',
  group_id: null,
  name: 'General',
  path: 'Peluquería / General',
  form_type: 'general',
  form_version: 1,
  price_mode: 'custom',
  reference_price: null,
  price: null,
  status: 'draft',
  technical: createTechnicalData('general'),
  completed_at: null,
};
beforeEach(() => {
  vi.useFakeTimers();
  mocks.command.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('autoguardado con respuesta real del servidor', () => {
  it('conserva precio pendiente como null y sólo confirma después de la respuesta', async () => {
    let resolve!: (value: { version: number }) => void;
    mocks.command.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useTechnicalDraft(service));
    act(() =>
      result.current.setDraft((d) => ({ ...d, technical: { ...d.technical, notes: 'Fórmula A' } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.saved).toBe(false);
    expect(mocks.command.mock.calls[0][1]).toMatchObject({
      price: null,
      technical: { notes: 'Fórmula A' },
    });
    await act(async () => {
      resolve({ version: 2 });
    });
    expect(result.current.saved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });
  it('guarda la edición posterior sin marcarla falsamente como confirmada', async () => {
    let resolve!: (value: { version: number }) => void;
    mocks.command
      .mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        }),
      )
      .mockResolvedValue({ version: 3 });
    const { result } = renderHook(() => useTechnicalDraft(service));
    act(() =>
      result.current.setDraft((d) => ({ ...d, technical: { ...d.technical, notes: 'Primera' } })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    act(() =>
      result.current.setDraft((d) => ({ ...d, technical: { ...d.technical, notes: 'Segunda' } })),
    );
    await act(async () => {
      resolve({ version: 2 });
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(mocks.command.mock.calls[1][1]).toMatchObject({
      version: 2,
      technical: { notes: 'Segunda' },
    });
    expect(result.current.dirty).toBe(false);
  });
  it('reintenta una respuesta incierta con el mismo identificador y contenido', async () => {
    mocks.command
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ version: 2 });
    const { result } = renderHook(() => useTechnicalDraft(service));
    act(() => result.current.setDraft((d) => ({ ...d, price: '200000' })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(result.current.error).toBeTruthy();
    act(() => result.current.setDraft((d) => ({ ...d, price: '210000' })));
    await act(async () => {
      await result.current.save();
    });
    expect(mocks.command.mock.calls[1]).toEqual(mocks.command.mock.calls[0]);
    expect(result.current.dirty).toBe(true);
    expect(result.current.draft.price).toBe('210000');
  });
  it('dos atenciones mantienen borradores y versiones independientes', async () => {
    mocks.command.mockResolvedValue({ version: 2 });
    const first = renderHook(() => useTechnicalDraft(service));
    const second = renderHook(() => useTechnicalDraft({ ...service, id: 's2' }));
    act(() => first.result.current.setDraft((d) => ({ ...d, price: '100000' })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(first.result.current.draft.price).toBe('100000');
    expect(second.result.current.draft.price).toBe('');
    expect(mocks.command).toHaveBeenCalledTimes(1);
  });
  it('bloquea guardados sin conexión', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() => useTechnicalDraft(service));
    act(() => result.current.setDraft((d) => ({ ...d, price: '1' })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(result.current.error).toMatch(/Sin conexión/);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(result.current.saved).toBe(false);
  });
  it('actualiza la tarifa y versión tras refrescar un borrador sin cambios', async () => {
    const { result, rerender } = renderHook(({ value }) => useTechnicalDraft(value), {
      initialProps: { value: service },
    });
    rerender({ value: { ...service, price: 50000, version: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.draft.price).toBe('50000');
    expect(result.current.version).toBe(2);
    expect(result.current.dirty).toBe(false);
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it('un cambio remoto conserva la edición local y su versión original para detectar conflicto', async () => {
    const { result, rerender } = renderHook(({ value }) => useTechnicalDraft(value), {
      initialProps: { value: service },
    });
    act(() => result.current.setDraft((d) => ({ ...d, price: '70000' })));
    rerender({ value: { ...service, price: 50000, version: 2 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.draft.price).toBe('70000');
    expect(result.current.version).toBe(1);
    expect(result.current.dirty).toBe(true);
  });
});
