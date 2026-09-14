import { useState, useSyncExternalStore } from 'react';
import { checkPendingOperation, retryPendingOperation } from '../lib/api';
import { getPendingOperations, subscribeOperations } from '../lib/pendingOperations';

function operationName(action: string) {
  const names: Record<string, string> = {
    payment: 'un pago',
    sale: 'una venta',
    inventory: 'un movimiento de inventario',
    appointment: 'una cita',
    client: 'los datos de una clienta',
    service_record: 'una ficha',
    visit: 'una visita',
    expense: 'un gasto',
    cash: 'la caja',
  };
  return names[action.split('.')[0]] ?? 'un cambio';
}
export function PendingOperationsBanner({ online }: { online: boolean }) {
  const operations = useSyncExternalStore(
    subscribeOperations,
    getPendingOperations,
    getPendingOperations,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const uncertain = operations.filter((entry) => entry.state === 'uncertain' || entry.id === busy);
  async function resolve(id: string, replay: boolean) {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      const confirmed = replay
        ? (await retryPendingOperation(id), true)
        : await checkPendingOperation(id);
      setMessage(
        confirmed
          ? 'Guardado confirmado. Revisa los datos actualizados antes de registrar otro cambio.'
          : 'Aún no aparece una confirmación registrada. Usa «Reintentar confirmación» para enviar los mismos datos de forma segura.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo comprobar el resultado. Conserva esta pestaña abierta.',
      );
    } finally {
      setBusy(null);
    }
  }
  if (!uncertain.length && !message && !error) return null;
  return (
    <section className="notice" aria-label="Confirmaciones pendientes">
      {uncertain.length > 0 && (
        <>
          <strong>Hay una confirmación incierta</strong>
          <p>
            Conserva esta pestaña abierta. Comprueba el resultado antes de guardar otros cambios.
          </p>
        </>
      )}
      {uncertain.map((entry) => (
        <div key={entry.id} className="stack">
          <p>Por comprobar: {operationName(entry.action)}.</p>
          <div className="actions">
            <button
              className="button-secondary"
              disabled={!online || busy !== null}
              onClick={() => void resolve(entry.id, false)}
            >
              {busy === entry.id ? 'Comprobando…' : 'Comprobar resultado'}
            </button>
            <button
              className="button-secondary"
              disabled={!online || busy !== null}
              onClick={() => void resolve(entry.id, true)}
            >
              Reintentar confirmación
            </button>
          </div>
        </div>
      ))}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!uncertain.length && (
        <button
          className="button-secondary"
          onClick={() => {
            setMessage('');
            setError('');
          }}
        >
          Entendido
        </button>
      )}
    </section>
  );
}
