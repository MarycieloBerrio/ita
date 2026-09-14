import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Product, StockMovement } from '../../lib/contracts';
import { bogotaDate, OperationFeedback, useOperation } from '../catalog/operations';

const schema = z.object({
  product_id: z.string().min(1, 'Selecciona un producto.'),
  kind: z.enum(['initial', 'purchase', 'consumption', 'adjustment']),
  quantity: z.string().regex(/^-?[1-9]\d*$/, 'Usa una cantidad entera distinta de cero.'),
  reason: z.string().trim().min(3, 'Explica el motivo.').max(1000),
  visit_id: z
    .string()
    .refine(
      (value) => value === '' || z.string().uuid().safeParse(value).success,
      'Usa un identificador de visita válido.',
    ),
});
type Values = z.infer<typeof schema>;
export const movementLabels: Record<StockMovement['kind'], string> = {
  initial: 'Conteo inicial',
  purchase: 'Compra recibida',
  consumption: 'Salida manual',
  adjustment: 'Ajuste de conteo',
  sale: 'Venta confirmada',
  correction: 'Rectificación',
};

export default function StockEditor({
  products,
  selectedProduct,
  correction,
  onClose,
}: {
  products: Product[];
  selectedProduct?: string;
  correction?: StockMovement;
  onClose: () => void;
}) {
  const operation = useOperation();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      product_id: correction?.product_id ?? selectedProduct ?? '',
      kind: 'initial',
      quantity: '',
      reason: '',
      visit_id: '',
    },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const productId = useWatch({ control: form.control, name: 'product_id' });
  const rawQuantity = Number(useWatch({ control: form.control, name: 'quantity' }));
  const product = products.find((item) => item.id === productId);
  const quantity =
    correction || kind === 'adjustment'
      ? rawQuantity
      : kind === 'consumption'
        ? -Math.abs(rawQuantity)
        : Math.abs(rawQuantity);
  async function save(values: Values) {
    if (!correction && kind !== 'adjustment' && rawQuantity < 1) {
      operation.setError('Introduce una cantidad positiva. La salida restará esas unidades.');
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity === 0) {
      operation.setError('Introduce unidades enteras distintas de cero.');
      return;
    }
    const result = correction
      ? await operation.run(
          'inventory.correct',
          { id: correction.id, quantity, reason: values.reason },
          'Rectificación confirmada; original conservado',
        )
      : await operation.run(
          'inventory.move',
          {
            product_id: values.product_id,
            kind: values.kind,
            quantity,
            reason: values.reason,
            ...(values.visit_id ? { visit_id: values.visit_id } : {}),
          },
          'Movimiento confirmado',
        );
    if (result !== undefined) onClose();
  }
  return (
    <section className="card stack">
      <h2>{correction ? 'Rectificar registro de inventario' : 'Registrar movimiento'}</h2>
      {correction ? (
        <p className="muted">
          Original: {correction.name}, {correction.quantity > 0 ? '+' : ''}
          {correction.quantity} unidades · {bogotaDate(correction.created_at)}. La rectificación
          añade la diferencia indicada y conserva el registro original.
        </p>
      ) : (
        <p className="muted">
          Anotar materiales en una ficha no reduce existencias. Confirma aquí el movimiento físico.
        </p>
      )}
      <form className="stack" onSubmit={(event) => void form.handleSubmit(save)(event)}>
        <div className="form-grid">
          <label className="field">
            Producto
            <select {...form.register('product_id')} disabled={Boolean(correction)}>
              <option value="">Seleccionar</option>
              {products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.stock} unidades
                </option>
              ))}
            </select>
            {form.formState.errors.product_id ? (
              <span className="error">{form.formState.errors.product_id.message}</span>
            ) : null}
          </label>
          {!correction ? (
            <label className="field">
              Tipo de movimiento
              <select {...form.register('kind')}>
                <option value="initial">Entrada · conteo inicial</option>
                <option value="purchase">Entrada · compra recibida</option>
                <option value="consumption">Salida · uso interno / merma</option>
                <option value="adjustment">Ajuste · diferencia de conteo</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            {correction || kind === 'adjustment'
              ? 'Diferencia de unidades (+ / −)'
              : 'Cantidad de unidades'}
            <input
              inputMode={correction || kind === 'adjustment' ? 'text' : 'numeric'}
              {...form.register('quantity')}
            />
            {form.formState.errors.quantity ? (
              <span className="error">{form.formState.errors.quantity.message}</span>
            ) : null}
          </label>
          {!correction && kind === 'consumption' ? (
            <label className="field">
              Visita relacionada · opcional
              <input {...form.register('visit_id')} placeholder="Identificador de la visita" />
              {form.formState.errors.visit_id ? (
                <span className="error">{form.formState.errors.visit_id.message}</span>
              ) : (
                <small>Vacío: consumo general del salón.</small>
              )}
            </label>
          ) : null}
        </div>
        <label className="field">
          Motivo
          <textarea
            rows={3}
            {...form.register('reason')}
            placeholder="Describe lo recibido, utilizado o corregido"
          />
          {form.formState.errors.reason ? (
            <span className="error">{form.formState.errors.reason.message}</span>
          ) : null}
        </label>
        {product && Number.isSafeInteger(quantity) && quantity !== 0 ? (
          <p className="badge">
            Existencias actuales: {product.stock} · Cambio: {quantity > 0 ? '+' : ''}
            {quantity} · Resultado previsto: {product.stock + quantity}. El servidor comprobará la
            disponibilidad al confirmar.
          </p>
        ) : null}
        {kind === 'purchase' && !correction ? (
          <p className="muted">
            Recibir la compra registra unidades. Registra su pago una sola vez en Finanzas, enlazado
            a este movimiento.
          </p>
        ) : null}
        <OperationFeedback error={operation.error} success={operation.success} />
        <div className="actions">
          <button className="button" disabled={operation.pending}>
            {operation.pending
              ? 'Confirmando…'
              : correction
                ? 'Confirmar rectificación'
                : kind === 'consumption'
                  ? 'Registrar salida'
                  : 'Confirmar movimiento'}
          </button>
          <button className="button-secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
        </div>
      </form>
    </section>
  );
}
