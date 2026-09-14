import { useCallback, useEffect, useRef, useState } from 'react';
import type { VisitService } from '../../lib/contracts';
import type { TechnicalData } from '../technical/types';
import { technicalDataSchema } from '../technical/types';
import { ApiError, command, queryClient } from '../../lib/api';
import { errorMessage } from '../../lib/format';
import {
  acknowledgeOperation,
  findOperationRetry,
  getCompletedOperation,
  subscribeOperations,
} from '../../lib/pendingOperations';
export interface TechnicalDraft {
  technical: TechnicalData;
  price: string;
}
function fromService(service: VisitService): TechnicalDraft {
  return {
    technical: structuredClone(service.technical),
    price: service.price == null ? '' : String(service.price),
  };
}
export function useTechnicalDraft(service: VisitService) {
  const [draft, setDraft] = useState(() => fromService(service));
  const [version, setVersion] = useState(service.version);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [locallyCompleted, setLocallyCompleted] = useState(false);
  const current = useRef(draft);
  const running = useRef(false);
  const pending = useRef<{
    id: string;
    payload: object;
    snapshot: TechnicalDraft;
    completes: boolean;
  } | null>(null);
  const dirty = JSON.stringify(draft) !== savedSnapshot;
  const invalid = !technicalDataSchema.safeParse(draft.technical).success;
  const save = useCallback(
    async (complete = false, reason?: string, automatic = false) => {
      if (running.current) return false;
      if (!navigator.onLine) {
        setError('Sin conexión. Estos cambios aún no se han guardado.');
        return false;
      }
      if (pending.current && complete) {
        setError('Primero reintenta el guardado pendiente. Después puedes finalizar el trabajo.');
        return false;
      }
      if (!pending.current) {
        const snapshot = structuredClone(current.current);
        const parsed = technicalDataSchema.safeParse(snapshot.technical);
        if (!parsed.success) {
          setError(
            'La ficha contiene datos inválidos. Revisa sus campos; no se ha reemplazado información guardada.',
          );
          return false;
        }
        const price = snapshot.price === '' ? null : Number(snapshot.price);
        if (price !== null && (!Number.isSafeInteger(price) || price <= 0)) {
          setError('El precio debe ser un número positivo de pesos enteros.');
          return false;
        }
        const payload = {
          id: service.id,
          version,
          technical: snapshot.technical,
          ...(service.price_mode === 'custom' ? { price } : {}),
          status: complete || service.status === 'completed' ? 'completed' : 'draft',
          ...(reason ? { reason } : {}),
        };
        const recoveryId = findOperationRetry('service_record.save', payload);
        if (automatic && recoveryId) {
          setError('Hay un guardado anterior por revisar. Usa Guardar ficha para comprobarlo.');
          return false;
        }
        pending.current = {
          id: recoveryId ?? crypto.randomUUID(),
          snapshot,
          completes: complete,
          payload,
        };
      }
      const attempt = pending.current;
      running.current = true;
      setBusy(true);
      setError('');
      try {
        const result = await command<{ version: number }>(
          'service_record.save',
          attempt.payload,
          attempt.id,
        );
        setVersion(result.version);
        setSavedSnapshot(JSON.stringify(attempt.snapshot));
        pending.current = null;
        setSaved(true);
        if (attempt.completes) setLocallyCompleted(true);
        await queryClient.invalidateQueries({ queryKey: ['visit'] });
        return true;
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.code &&
          (/^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(cause.code) ||
            ['OPERATION_PENDING', 'AUTH_REQUIRED', 'AUTH_CHANGED'].includes(cause.code))
        )
          pending.current = null;
        setError(errorMessage(cause));
        return false;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [service.id, service.price_mode, service.status, version],
  );
  useEffect(() => {
    current.current = draft;
  }, [draft]);
  useEffect(
    () =>
      subscribeOperations(() => {
        const attempt = pending.current;
        if (!attempt || running.current) return;
        const outcome = getCompletedOperation(attempt.id);
        if (!outcome) return;
        acknowledgeOperation(outcome.actorId, attempt.id);
        pending.current = null;
        if (outcome.error) {
          setError(outcome.error.message);
          return;
        }
        const result = outcome.result as { version: number };
        setVersion(result.version);
        setSavedSnapshot(JSON.stringify(attempt.snapshot));
        setSaved(true);
        if (attempt.completes) setLocallyCompleted(true);
        setError(
          JSON.stringify(current.current) === JSON.stringify(attempt.snapshot)
            ? ''
            : 'El guardado anterior se confirmó. Quedan cambios nuevos; revísalos y pulsa Guardar ficha.',
        );
      }),
    [],
  );
  useEffect(() => {
    // A confirmed server refresh may replace a pristine draft, never unsaved work.
    if (service.version <= version || dirty || busy || error || pending.current) return;
    const next = fromService(service);
    const timer = setTimeout(() => {
      current.current = next;
      setDraft(next);
      setVersion(service.version);
      setSavedSnapshot(JSON.stringify(next));
    }, 0);
    return () => clearTimeout(timer);
  }, [service, version, dirty, busy, error]);
  useEffect(() => {
    if (!dirty || busy || error || locallyCompleted || service.status !== 'draft') return;
    const timer = setTimeout(() => void save(false, undefined, true), 1200);
    return () => clearTimeout(timer);
  }, [dirty, draft, busy, error, save, service.status, locallyCompleted]);
  function reload() {
    if (pending.current && getCompletedOperation(pending.current.id)) pending.current = null;
    if (pending.current) {
      setError('Reintenta la confirmación incierta antes de recargar para conocer su resultado.');
      return;
    }
    const next = fromService(service);
    setDraft(next);
    current.current = next;
    setVersion(service.version);
    setSavedSnapshot(JSON.stringify(next));
    setError('');
    setSaved(false);
  }
  return { draft, setDraft, dirty, invalid, version, busy, error, saved, save, reload };
}
