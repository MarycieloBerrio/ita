import { useRef, useState } from 'react';
import { command, queryClient, ApiError } from './api';
import { errorMessage } from './format';
import { findOperationRetry, getCompletedOperation, operationSignature } from './pendingOperations';
export function useOperation() {
  const attempt = useRef<{ action: string; payload: object; key: string } | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function run<T = Record<string, unknown>>(
    action: string,
    payload: object,
  ): Promise<T | null> {
    if (busy.current) return null;
    if (!navigator.onLine) {
      setError('Sin conexión. Conserva esta página abierta para reintentar.');
      return null;
    }
    if (
      attempt.current &&
      getCompletedOperation(attempt.current.key) &&
      operationSignature(attempt.current.action, attempt.current.payload) !==
        operationSignature(action, payload)
    )
      attempt.current = null;
    if (
      attempt.current &&
      (attempt.current.action !== action ||
        operationSignature(action, attempt.current.payload) !== operationSignature(action, payload))
    ) {
      setError(
        'Hay una confirmación incierta. Reintenta primero la operación anterior antes de cambiar sus datos.',
      );
      return null;
    }
    attempt.current ??= {
      action,
      payload: structuredClone(payload),
      key: findOperationRetry(action, payload) ?? crypto.randomUUID(),
    };
    busy.current = true;
    setPending(true);
    setError('');
    setSaved(false);
    try {
      const result = await command<T>(action, attempt.current.payload, attempt.current.key);
      attempt.current = null;
      setSaved(true);
      await queryClient.invalidateQueries();
      return result;
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.code &&
        (/^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(e.code) ||
          ['OPERATION_PENDING', 'AUTH_REQUIRED', 'AUTH_CHANGED'].includes(e.code))
      )
        attempt.current = null;
      setError(errorMessage(e));
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { run, pending, error, saved };
}
