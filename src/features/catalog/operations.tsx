import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, command } from '../../lib/api';
import {
  findOperationRetry,
  getCompletedOperation,
  operationSignature,
} from '../../lib/pendingOperations';

export type { Category } from '../../lib/contracts';
import type { Category } from '../../lib/contracts';

export const cop = (value: number | null | undefined) =>
  value == null
    ? 'Pendiente'
    : new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(value);
export const bogotaDate = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
export const todayBogota = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const integerAmount = (value: string, allowZero = false): number => {
  if (!/^\d+$/.test(value)) throw new Error('Introduce un importe en pesos enteros.');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > 9_000_000_000_000 || amount < (allowZero ? 0 : 1))
    throw new Error('El importe debe ser positivo y válido.');
  return amount;
};

export function categoryPath(categories: Category[], id: string | null): string {
  if (!id) return 'Sin categoría';
  const names: string[] = [];
  const seen = new Set<string>();
  let node = categories.find((category) => category.id === id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    names.unshift(node.name);
    node = categories.find((category) => category.id === node?.parent_id);
  }
  return names.join(' / ') || 'Categoría archivada';
}

export function categoryContains(
  categories: Category[],
  ancestor: string,
  id: string | null,
): boolean {
  if (!ancestor) return true;
  const seen = new Set<string>();
  let current = id;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = categories.find((category) => category.id === current)?.parent_id ?? null;
  }
  return false;
}

/** A failed transport keeps its operation key, so an identical retry cannot duplicate a movement. */
export function useOperation() {
  const client = useQueryClient();
  const busy = useRef(false);
  const last = useRef<{ signature: string; id: string; payload: Record<string, unknown> } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function run<T>(
    action: string,
    payload: Record<string, unknown>,
    message = 'Guardado confirmado',
  ): Promise<T | undefined> {
    if (busy.current) return undefined;
    if (!navigator.onLine) {
      setError(
        'Sin conexión. Conservamos lo escrito en esta pestaña; vuelve a intentar cuando tengas Internet.',
      );
      return undefined;
    }
    const signature = operationSignature(action, payload);
    if (
      last.current &&
      getCompletedOperation(last.current.id) &&
      last.current.signature !== signature
    )
      last.current = null;
    if (last.current && last.current.signature !== signature) {
      setError(
        'Hay una confirmación incierta. Reintenta primero con los mismos datos de la operación anterior para comprobar su resultado.',
      );
      return undefined;
    }
    last.current ??= {
      signature,
      id: findOperationRetry(action, payload) ?? crypto.randomUUID(),
      payload: structuredClone(payload),
    };
    busy.current = true;
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const result = await command<T>(action, last.current.payload, last.current.id);
      last.current = null;
      await client.invalidateQueries();
      setSuccess(message);
      return result;
    } catch (cause) {
      // Only an explicit database rejection proves that the transaction was rolled back.
      // Transport/proxy errors and connection exception codes leave confirmation uncertain.
      if (
        cause instanceof ApiError &&
        (/^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(cause.code ?? '') ||
          ['OPERATION_PENDING', 'AUTH_REQUIRED', 'AUTH_CHANGED'].includes(cause.code ?? ''))
      )
        last.current = null;
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo confirmar. Reintenta la misma operación para comprobar su resultado.',
      );
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    run,
    pending,
    error,
    success,
    setError,
    clear: () => {
      setError('');
      setSuccess('');
    },
  };
}

export function OperationFeedback({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="success" role="status">
          {success}
        </p>
      ) : null}
    </>
  );
}

export function QueryFeedback({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => unknown;
}) {
  if (pending)
    return (
      <p className="muted" role="status">
        Cargando información…
      </p>
    );
  if (error)
    return (
      <div className="error" role="alert">
        <p>{error.message}</p>
        <button className="button-secondary" onClick={() => void retry()}>
          Volver a intentar
        </button>
      </div>
    );
  return null;
}
