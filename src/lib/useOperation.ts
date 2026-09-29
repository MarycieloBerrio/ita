import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { command } from './api';
import { releasesOperationKey } from './operationErrors';
import { findOperationRetry, getCompletedOperation, operationSignature } from './pendingOperations';
import { cloneJson, createUuid } from './browserCompatibility';

/**
 * Runs one confirmed command per form. A failed transport keeps its operation key, so an
 * identical explicit retry cannot duplicate a payment or stock movement. `run` resolves to the
 * server result, or `undefined` when nothing was confirmed (the reason is in `error`).
 */
export function useOperation() {
  const client = useQueryClient();
  const busy = useRef(false);
  const last = useRef<{ signature: string; id: string; payload: object } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function run<T = Record<string, unknown>>(
    action: string,
    payload: object,
    message = 'Guardado confirmado',
  ): Promise<T | undefined> {
    if (busy.current) return undefined;
    setSuccess('');
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
      id: findOperationRetry(action, payload) ?? createUuid(),
      payload: cloneJson(payload),
    };
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = await command<T>(action, last.current.payload, last.current.id);
      last.current = null;
      setSuccess(message);
      await client.invalidateQueries();
      return result;
    } catch (cause) {
      // Only an explicit database rejection proves that the transaction was rolled back.
      // Transport/proxy errors and connection exception codes leave confirmation uncertain.
      if (releasesOperationKey(cause)) last.current = null;
      setError(
        cause instanceof Error && cause.message
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
    /** Convenience flag for forms that only show a generic confirmation. */
    saved: success !== '',
    setError: (message: string) => {
      setSuccess('');
      setError(message);
    },
    clear: () => {
      setError('');
      setSuccess('');
    },
  };
}
