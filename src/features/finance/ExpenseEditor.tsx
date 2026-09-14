import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Expense, PaymentMethod, StockMovement } from '../../lib/contracts';
import { bogotaDate, integerAmount, OperationFeedback, useOperation } from '../catalog/operations';
import { bogotaInput, paymentTimestamp } from './reporting';

const schema = z
  .object({
    concept: z.string().trim().min(1, 'Escribe el concepto.').max(200),
    category: z.string().trim().min(1, 'Escribe una categoría.').max(100),
    amount: z.string(),
    method_id: z.string().min(1, 'Selecciona un método.'),
    paid_at: z.string().min(1),
    stock_movement_id: z.string(),
    reason: z.string().max(1000),
  })
  .superRefine((values, ctx) => {
    try {
      integerAmount(values.amount);
    } catch {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Introduce pesos enteros positivos.',
      });
    }
  });
type Values = z.infer<typeof schema>;
export default function ExpenseEditor({
  methods,
  purchases,
  correction,
  onClose,
}: {
  methods: PaymentMethod[];
  purchases: StockMovement[];
  correction?: Expense;
  onClose: () => void;
}) {
  const operation = useOperation();
  const [initialTimestamp] = useState(() => correction?.paid_at ?? new Date().toISOString());
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      concept: correction?.concept ?? '',
      category: correction?.category ?? '',
      amount: correction ? String(correction.amount) : '',
      method_id: correction?.method_id ?? '',
      paid_at: bogotaInput(initialTimestamp, true),
      stock_movement_id: correction?.stock_movement_id ?? '',
      reason: '',
    },
  });
  async function save(values: Values) {
    try {
      if (correction && values.reason.trim().length < 3) {
        form.setError('reason', { message: 'Explica el error de registro.' });
        return;
      }
      const payload = {
        concept: values.concept,
        category: values.category,
        amount: integerAmount(values.amount),
        method_id: values.method_id,
        paid_at: paymentTimestamp(values.paid_at, initialTimestamp),
      };
      const result = correction
        ? await operation.run(
            'expense.correct',
            { ...payload, id: correction.id, reason: values.reason },
            'Egreso rectificado; original conservado',
          )
        : await operation.run(
            'expense.save',
            {
              ...payload,
              ...(values.stock_movement_id ? { stock_movement_id: values.stock_movement_id } : {}),
            },
            'Egreso pagado confirmado',
          );
      if (result !== undefined) onClose();
    } catch (cause) {
      operation.setError(cause instanceof Error ? cause.message : 'Revisa el egreso.');
    }
  }
  return (
    <form className="card stack" onSubmit={(event) => void form.handleSubmit(save)(event)}>
      <h2>{correction ? 'Rectificar egreso registrado por error' : 'Registrar egreso pagado'}</h2>
      <p className="muted">
        Registra la compra una sola vez cuando se paga. Recibir unidades en inventario no crea otro
        gasto.
      </p>
      <div className="form-grid">
        <label className="field">
          Concepto
          <input {...form.register('concept')} autoFocus />
          {form.formState.errors.concept ? (
            <span className="error">{form.formState.errors.concept.message}</span>
          ) : null}
        </label>
        <label className="field">
          Categoría de gasto
          <input {...form.register('category')} placeholder="Escribe la categoría del salón" />
          {form.formState.errors.category ? (
            <span className="error">{form.formState.errors.category.message}</span>
          ) : null}
        </label>
        <label className="field">
          Importe pagado
          <input inputMode="numeric" {...form.register('amount')} />
          {form.formState.errors.amount ? (
            <span className="error">{form.formState.errors.amount.message}</span>
          ) : null}
        </label>
        <label className="field">
          Método
          <select {...form.register('method_id')}>
            <option value="">Seleccionar</option>
            {methods
              .filter((item) => item.active || item.id === correction?.method_id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          {form.formState.errors.method_id ? (
            <span className="error">{form.formState.errors.method_id.message}</span>
          ) : null}
        </label>
        <label className="field">
          Fecha y hora real
          <input type="datetime-local" step="1" {...form.register('paid_at')} />
        </label>
        {!correction ? (
          <label className="field">
            Compra recibida relacionada · opcional
            <select {...form.register('stock_movement_id')}>
              <option value="">No corresponde a una compra de inventario</option>
              {purchases.map((item) => (
                <option key={item.id} value={item.id}>
                  {bogotaDate(item.created_at)} · {item.name} · {item.quantity} unidades
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {correction ? (
        <label className="field">
          Motivo
          <textarea {...form.register('reason')} />
          {form.formState.errors.reason ? (
            <span className="error">{form.formState.errors.reason.message}</span>
          ) : null}
        </label>
      ) : null}
      <OperationFeedback error={operation.error} success={operation.success} />
      <div className="actions">
        <button className="button" disabled={operation.pending}>
          {operation.pending
            ? 'Confirmando…'
            : correction
              ? 'Confirmar rectificación'
              : 'Confirmar egreso'}
        </button>
        <button className="button-secondary" type="button" onClick={onClose}>
          Cancelar
        </button>
        {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
      </div>
    </form>
  );
}
