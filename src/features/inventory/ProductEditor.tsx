import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Category, Product } from '../../lib/contracts';
import {
  categoryPath,
  integerAmount,
  OperationFeedback,
  useOperation,
} from '../catalog/operations';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre.').max(150),
    category_id: z.string().min(1, 'Selecciona una categoría.'),
    brand: z.string().max(150),
    presentation: z.string().max(150),
    code: z.string().max(80),
    usage: z.enum(['sale', 'internal', 'both']),
    cost: z.string(),
    sale_price: z.string(),
    minimum_stock: z.string().regex(/^\d+$/, 'Usa unidades enteras.'),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.cost) {
      try {
        integerAmount(value.cost, true);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['cost'],
          message: 'Costo inválido en pesos enteros.',
        });
      }
    }
    if (value.usage !== 'internal') {
      try {
        integerAmount(value.sale_price);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['sale_price'],
          message: 'Define un precio de venta positivo.',
        });
      }
    }
  });
type Values = z.infer<typeof schema>;

export default function ProductEditor({
  product,
  categories,
  onClose,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
}) {
  const operation = useOperation();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? '',
      category_id: product?.category_id ?? '',
      brand: product?.brand ?? '',
      presentation: product?.presentation ?? '',
      code: product?.code ?? '',
      usage: product?.usage ?? 'both',
      cost: product?.cost == null ? '' : String(product.cost),
      sale_price: product?.sale_price == null ? '' : String(product.sale_price),
      minimum_stock: String(product?.minimum_stock ?? 0),
      active: product?.active ?? true,
    },
  });
  const usage = useWatch({ control: form.control, name: 'usage' });
  async function save(values: Values) {
    const result = await operation.run('product.save', {
      ...values,
      id: product?.id,
      version: product?.version,
      cost: values.cost ? integerAmount(values.cost, true) : null,
      sale_price: values.usage !== 'internal' ? integerAmount(values.sale_price) : null,
      minimum_stock: Number(values.minimum_stock),
    });
    if (result !== undefined) onClose();
  }
  return (
    <section className="card stack">
      <h2>{product ? 'Editar producto' : 'Nuevo producto'}</h2>
      <p className="muted">
        La presentación describe el envase. Las existencias se cuentan en unidades enteras y se
        registran por movimientos.
      </p>
      <form onSubmit={(event) => void form.handleSubmit(save)(event)} className="stack">
        <div className="form-grid">
          <label className="field">
            Nombre
            <input {...form.register('name')} autoFocus />
            {form.formState.errors.name ? (
              <span className="error">{form.formState.errors.name.message}</span>
            ) : null}
          </label>
          <label className="field">
            Categoría
            <select {...form.register('category_id')}>
              <option value="">Seleccionar</option>
              {categories
                .filter((item) => item.active || item.id === product?.category_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {categoryPath(categories, item.id)}
                  </option>
                ))}
            </select>
            {form.formState.errors.category_id ? (
              <span className="error">{form.formState.errors.category_id.message}</span>
            ) : null}
          </label>
          <label className="field">
            Marca / referencia
            <input {...form.register('brand')} />
          </label>
          <label className="field">
            Presentación
            <input {...form.register('presentation')} placeholder="Ej. frasco 250 ml" />
          </label>
          <label className="field">
            Código opcional
            <input {...form.register('code')} />
          </label>
          <label className="field">
            Uso
            <select {...form.register('usage')}>
              <option value="both">Venta e interno</option>
              <option value="sale">Venta</option>
              <option value="internal">Interno</option>
            </select>
          </label>
          <label className="field">
            Costo por unidad · COP
            <input inputMode="numeric" {...form.register('cost')} placeholder="Sin registrar" />
            {form.formState.errors.cost ? (
              <span className="error">{form.formState.errors.cost.message}</span>
            ) : (
              <small>Visible únicamente para la dueña.</small>
            )}
          </label>
          {usage !== 'internal' ? (
            <label className="field">
              Precio de venta · COP
              <input inputMode="numeric" {...form.register('sale_price')} />
              {form.formState.errors.sale_price ? (
                <span className="error">{form.formState.errors.sale_price.message}</span>
              ) : null}
            </label>
          ) : null}
          <label className="field">
            Mínimo de unidades
            <input inputMode="numeric" {...form.register('minimum_stock')} />
            {form.formState.errors.minimum_stock ? (
              <span className="error">{form.formState.errors.minimum_stock.message}</span>
            ) : null}
          </label>
        </div>
        <label className="actions">
          <input type="checkbox" {...form.register('active')} /> Producto activo
        </label>
        <OperationFeedback error={operation.error} success={operation.success} />
        <div className="actions">
          <button className="button" disabled={operation.pending}>
            {operation.pending ? 'Guardando…' : 'Guardar producto'}
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            Cerrar editor
          </button>
          {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
        </div>
      </form>
    </section>
  );
}
