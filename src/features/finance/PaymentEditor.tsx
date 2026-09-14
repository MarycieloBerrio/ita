import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Account, Payment, PaymentMethod } from '../../lib/contracts';
import { cop, integerAmount, OperationFeedback, useOperation } from '../catalog/operations';
import { bogotaInput, paymentTimestamp } from './reporting';

const schema = z
  .object({
    amount: z.string(),
    method_id: z.string().min(1, 'Configura y selecciona un método de pago.'),
    paid_at: z.string().min(1),
    reference: z.string().max(200),
    reason: z.string().max(1000),
  })
  .superRefine((values, ctx) => {
    try {
      integerAmount(values.amount);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Escribe un importe positivo en pesos enteros.',
      });
    }
  });
type Values = z.infer<typeof schema>;
export default function PaymentEditor({
  account,
  methods,
  correction,
  onClose,
}: {
  account: Account;
  methods: PaymentMethod[];
  correction?: Payment;
  onClose: () => void;
}) {
  const operation = useOperation();
  const [initialTimestamp] = useState(() => correction?.paid_at ?? new Date().toISOString());
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: correction ? String(correction.amount) : '',
      method_id: correction?.method_id ?? '',
      paid_at: bogotaInput(initialTimestamp, true),
      reference: correction?.reference ?? '',
      reason: '',
    },
  });
  async function save(values: Values) {
    try {
      const amount = integerAmount(values.amount);
      if (correction && values.reason.trim().length < 3) {
        form.setError('reason', { message: 'Explica el error de registro.' });
        return;
      }
      const payload = {
        amount,
        method_id: values.method_id,
        paid_at: paymentTimestamp(values.paid_at, initialTimestamp),
        reference: values.reference,
      };
      const result = correction
        ? await operation.run(
            'payment.correct',
            { ...payload, id: correction.id, reason: values.reason },
            'Pago rectificado; original conservado',
          )
        : await operation.run(
            'payment.record',
            { ...payload, account_id: account.id },
            'Pago confirmado',
          );
      if (result !== undefined) onClose();
    } catch (cause) {
      operation.setError(cause instanceof Error ? cause.message : 'Revisa los datos del pago.');
    }
  }
  return (
    <form className="card stack" onSubmit={(event) => void form.handleSubmit(save)(event)}>
      <h3>{correction ? 'Rectificar pago registrado por error' : 'Registrar pago'}</h3>
      {correction ? (
        <p>
          Original: {cop(correction.amount)} · {correction.method_name}. Conservamos original,
          motivo y responsable.
        </p>
      ) : (
        <p>
          Saldo pendiente: <strong>{cop(account.balance)}</strong>. Puedes registrar un pago parcial
          después de prestar los servicios o entregar los productos.
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          Importe · COP
          <input inputMode="numeric" {...form.register('amount')} autoFocus />
          {form.formState.errors.amount ? (
            <span className="error">{form.formState.errors.amount.message}</span>
          ) : null}
        </label>
        <label className="field">
          Método
          <select {...form.register('method_id')}>
            <option value="">Seleccionar</option>
            {methods
              .filter((method) => method.active || method.id === correction?.method_id)
              .map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
          </select>
          {form.formState.errors.method_id ? (
            <span className="error">{form.formState.errors.method_id.message}</span>
          ) : null}
        </label>
        <label className="field">
          Fecha y hora real · Bogotá
          <input type="datetime-local" step="1" {...form.register('paid_at')} />
        </label>
        <label className="field">
          Referencia opcional
          <input {...form.register('reference')} />
        </label>
      </div>
      {correction ? (
        <label className="field">
          Motivo de la rectificación
          <textarea {...form.register('reason')} />
          {form.formState.errors.reason ? (
            <span className="error">{form.formState.errors.reason.message}</span>
          ) : null}
        </label>
      ) : null}
      <OperationFeedback error={operation.error} success={operation.success} />
      <div className="actions">
        <button
          className="button"
          disabled={operation.pending || (!correction && !account.ready_for_payment)}
        >
          {operation.pending
            ? 'Confirmando…'
            : correction
              ? 'Confirmar rectificación'
              : 'Confirmar pago'}
        </button>
        <button type="button" className="button-secondary" onClick={onClose}>
          Cancelar
        </button>
        {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
      </div>
    </form>
  );
}
