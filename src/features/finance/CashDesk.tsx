import { useState } from 'react';
import type { CashMovement, CashSession } from '../../lib/contracts';
import {
  bogotaDate,
  cop,
  integerAmount,
  OperationFeedback,
  useOperation,
} from '../catalog/operations';

export default function CashDesk({
  sessions,
  movements,
}: {
  sessions: CashSession[];
  movements: CashMovement[];
}) {
  const operation = useOperation();
  const [kind, setKind] = useState<'contribution' | 'withdrawal'>('contribution');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const opened = sessions.find((item) => item.closed_at === null);
  async function perform(action: 'cash.open' | 'cash.move' | 'cash.close') {
    try {
      if (action === 'cash.move' && reason.trim().length < 3) {
        operation.setError('Escribe el motivo del aporte o retiro.');
        return;
      }
      const payload =
        action === 'cash.open'
          ? { opening_amount: integerAmount(amount, true), notes }
          : action === 'cash.close'
            ? {
                id: opened?.id,
                version: opened?.version,
                counted_amount: integerAmount(counted, true),
                notes,
              }
            : { session_id: opened?.id, kind, amount: integerAmount(amount), reason };
      const result = await operation.run(
        action,
        payload,
        action === 'cash.close'
          ? 'Cierre de caja confirmado'
          : action === 'cash.open'
            ? 'Apertura confirmada'
            : 'Movimiento de efectivo confirmado',
      );
      if (result !== undefined) {
        setAmount('');
        setReason('');
        setCounted('');
        setNotes('');
      }
    } catch (cause) {
      operation.setError(cause instanceof Error ? cause.message : 'Revisa el importe.');
    }
  }
  return (
    <section className="card stack">
      <h2>Caja de efectivo</h2>
      <p className="muted">
        La caja esperada suma apertura, cobros en efectivo y aportes, y resta egresos en efectivo y
        retiros. Transferencias y tarjetas permanecen fuera del cajón.
      </p>
      <OperationFeedback error={operation.error} success={operation.success} />
      {opened ? (
        <>
          <div className="operation-summary">
            <div>
              <span>Apertura · {bogotaDate(opened.opened_at)}</span>
              <strong>{cop(opened.opening_amount)}</strong>
            </div>
            <div>
              <span>Efectivo esperado</span>
              <strong>{cop(opened.expected_amount)}</strong>
            </div>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void perform('cash.move');
            }}
          >
            <h3>Aporte o retiro</h3>
            <div className="form-grid">
              <label className="field">
                Movimiento
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                >
                  <option value="contribution">Aporte de efectivo</option>
                  <option value="withdrawal">Retiro de efectivo</option>
                </select>
              </label>
              <label className="field">
                Importe · COP
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Motivo
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  minLength={3}
                />
              </label>
            </div>
            <button className="button-secondary" disabled={operation.pending}>
              Registrar {kind === 'contribution' ? 'aporte' : 'retiro'}
            </button>
          </form>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void perform('cash.close');
            }}
          >
            <h3>Cerrar caja</h3>
            <div className="form-grid">
              <label className="field">
                Efectivo contado · COP
                <input
                  inputMode="numeric"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                Observaciones del cierre
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
            </div>
            {/^\d+$/.test(counted) ? (
              <p>
                Diferencia prevista:{' '}
                <strong>{cop(Number(counted) - opened.expected_amount)}</strong>
              </p>
            ) : null}
            <button className="button" disabled={operation.pending}>
              Confirmar cierre
            </button>
          </form>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void perform('cash.open');
          }}
        >
          <p>No hay caja abierta.</p>
          <div className="form-grid">
            <label className="field">
              Efectivo de apertura · COP
              <input
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="field">
              Observaciones
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
          </div>
          <button className="button" disabled={operation.pending}>
            Confirmar apertura
          </button>
        </form>
      )}
      <details className="finance-detail">
        <summary>Cierres y movimientos del período</summary>
        {sessions.filter((item) => item.closed_at).length === 0 ? (
          <p className="empty">Sin cierres en este período.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cierre</th>
                <th>Esperado</th>
                <th>Contado</th>
                <th>Diferencia</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {sessions
                .filter((item) => item.closed_at)
                .map((item) => (
                  <tr key={item.id}>
                    <td>{bogotaDate(item.closed_at!)}</td>
                    <td>{cop(item.expected_amount)}</td>
                    <td>{cop(item.counted_amount)}</td>
                    <td>{cop(item.difference)}</td>
                    <td>{item.notes}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <h3>Aportes y retiros</h3>
        {movements.length === 0 ? (
          <p>Sin movimientos manuales de caja.</p>
        ) : (
          movements.map((item) => (
            <p key={item.id}>
              {bogotaDate(item.created_at)} · {item.kind === 'contribution' ? 'Aporte' : 'Retiro'} ·{' '}
              {cop(item.amount)} · {item.reason}
            </p>
          ))
        )}
      </details>
    </section>
  );
}
