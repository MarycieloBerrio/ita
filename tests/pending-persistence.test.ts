import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Journal = typeof import('../src/lib/pendingOperations');
const payload = { account_id: 'fictitious-account', amount: 100000 };
/** A fresh module instance behaves like the same tab after a reload. */
async function reload(): Promise<Journal> {
  vi.resetModules();
  return import('../src/lib/pendingOperations');
}
function start(journal: Journal, actor: string, id: string) {
  journal.beginOperation({
    actorId: actor,
    id,
    action: 'payment.record',
    payload,
    signature: journal.operationSignature('payment.record', payload),
  });
}
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Diario de operaciones pendientes tras recargar', () => {
  it('restaura una operación incierta con su clave original y sin reenviarla', async () => {
    const before = await reload();
    before.setOperationActor('owner');
    start(before, 'owner', 'op-1');
    before.markOperationUncertain('owner', 'op-1');

    const after = await reload();
    expect(after.getPendingOperations()).toHaveLength(0);
    after.setOperationActor('owner');
    expect(after.getPendingOperations()).toEqual([
      expect.objectContaining({ id: 'op-1', state: 'uncertain', payload }),
    ]);
    // Only an explicit resubmission with identical data reuses the key.
    expect(after.findOperationRetry('payment.record', payload)).toBe('op-1');
    expect(after.findOperationRetry('payment.record', { ...payload, amount: 1 })).toBeUndefined();
    expect(after.hasUnsettledOperations()).toBe(true);
  });

  it('una solicitud en curso al recargar vuelve como incierta', async () => {
    const before = await reload();
    before.setOperationActor('owner');
    start(before, 'owner', 'op-2');
    const after = await reload();
    after.setOperationActor('owner');
    expect(after.getPendingOperations()[0]).toMatchObject({ id: 'op-2', state: 'uncertain' });
  });

  it('una operación resuelta deja de guardarse', async () => {
    const before = await reload();
    before.setOperationActor('owner');
    start(before, 'owner', 'op-3');
    before.completeOperation('owner', 'op-3', { result: { id: 'ok' } });
    const after = await reload();
    after.setOperationActor('owner');
    expect(after.getPendingOperations()).toHaveLength(0);
  });

  it('cerrar sesión o cambiar de cuenta borra la copia guardada', async () => {
    const before = await reload();
    before.setOperationActor('owner');
    start(before, 'owner', 'op-4');
    before.setOperationActor(null);
    expect(sessionStorage.length).toBe(0);
    const after = await reload();
    after.setOperationActor('worker');
    expect(after.getPendingOperations()).toHaveLength(0);
    after.setOperationActor('owner');
    expect(after.getPendingOperations()).toHaveLength(0);
  });

  it('nunca restaura entradas de otra cuenta ni datos corruptos', async () => {
    sessionStorage.setItem(
      'ita.pendingOperations.v1:owner',
      JSON.stringify([{ actorId: 'worker', id: 'x', action: 'a', payload: {}, signature: 's' }, 1]),
    );
    const journal = await reload();
    journal.setOperationActor('owner');
    expect(journal.getPendingOperations()).toHaveLength(0);
    sessionStorage.setItem('ita.pendingOperations.v1:other', '{no es json');
    journal.setOperationActor('other');
    expect(journal.getPendingOperations()).toHaveLength(0);
  });

  it('si el almacenamiento falla, el diario en memoria sigue funcionando', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    const journal = await reload();
    journal.setOperationActor('owner');
    start(journal, 'owner', 'op-5');
    journal.markOperationUncertain('owner', 'op-5');
    expect(journal.findOperationRetry('payment.record', payload)).toBe('op-5');
  });
});
