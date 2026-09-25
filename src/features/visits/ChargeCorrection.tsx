import { useState } from 'react';
import type { VisitService } from '../../lib/contracts';
import { money } from '../../lib/format';
import { useOperation } from '../../lib/useOperation';

/** Owner-only rectification of the amount of a completed service (charge.correct). */
export default function ChargeCorrection({
  service,
  version,
  onClose,
}: {
  service: VisitService;
  version: number;
  onClose: () => void;
}) {
  const operation = useOperation();
  const [price, setPrice] = useState(service.price == null ? '' : String(service.price));
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState('');
  async function submit() {
    const amount = Number(price);
    if (!/^\d+$/.test(price) || !Number.isSafeInteger(amount) || amount <= 0) {
      setInvalid('Escribe un importe positivo en pesos enteros.');
      return;
    }
    if (reason.trim().length < 3) {
      setInvalid('Explica el error del importe.');
      return;
    }
    setInvalid('');
    const result = await operation.run(
      'charge.correct',
      { id: service.id, version, price: amount, reason: reason.trim() },
      'Importe rectificado; el anterior queda en auditoría',
    );
    if (result !== undefined) onClose();
  }
  return (
    <form
      className="stack notice"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <strong>Rectificar importe de la atención</strong>
      <span className="small">
        Importe actual: {money(service.price)}. Si ya hay pagos, el nuevo importe no puede quedar
        por debajo de lo cobrado.
      </span>
      <div className="form-grid">
        <label className="field">
          Importe correcto
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </label>
        <label className="field">
          Motivo del error *
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      {invalid || operation.error ? (
        <p className="error" role="alert">
          {invalid || operation.error}
        </p>
      ) : null}
      <div className="actions">
        <button className="button" disabled={operation.pending}>
          {operation.pending ? 'Confirmando…' : 'Confirmar importe'}
        </button>
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
