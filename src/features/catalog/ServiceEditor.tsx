import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Category, Service } from '../../lib/contracts';
import { categoryPath, integerAmount, OperationFeedback, useOperation } from './operations';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Escribe un nombre.').max(150),
    category_id: z.string().min(1, 'Selecciona una categoría.'),
    form_type: z.enum(['general', 'color', 'keratin']),
    price_mode: z.enum(['fixed', 'custom']),
    fixed_price: z.string(),
    duration_minutes: z.string().regex(/^\d+$/, 'Introduce minutos enteros.'),
    sort_order: z.string().regex(/^\d+$/),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (Number(value.duration_minutes) < 1 || Number(value.duration_minutes) > 1440)
      ctx.addIssue({
        code: 'custom',
        path: ['duration_minutes'],
        message: 'Usa entre 1 y 1440 minutos.',
      });
    if (value.price_mode === 'fixed' && (value.active || value.fixed_price !== '')) {
      try {
        integerAmount(value.fixed_price);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['fixed_price'],
          message: 'Un servicio fijo activo necesita su propio precio positivo.',
        });
      }
    }
  });
type Values = z.infer<typeof schema>;

export default function ServiceEditor({
  service,
  categories,
  onClose,
}: {
  service: Service | null;
  categories: Category[];
  onClose: () => void;
}) {
  const operation = useOperation();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: service?.name ?? '',
      category_id: service?.category_id ?? '',
      form_type: service?.form_type ?? 'general',
      price_mode: service?.price_mode ?? 'custom',
      fixed_price: service?.fixed_price == null ? '' : String(service.fixed_price),
      duration_minutes: String(service?.duration_minutes ?? 30),
      sort_order: String(service?.sort_order ?? 0),
      active: service?.active ?? true,
    },
  });
  const mode = useWatch({ control: form.control, name: 'price_mode' });
  async function save(values: Values) {
    const result = await operation.run('service.save', {
      ...values,
      id: service?.id,
      version: service?.version,
      fixed_price:
        values.price_mode === 'fixed' && values.fixed_price
          ? integerAmount(values.fixed_price)
          : null,
      duration_minutes: Number(values.duration_minutes),
      sort_order: Number(values.sort_order),
    });
    if (result !== undefined) onClose();
  }
  return (
    <section className="card stack">
      <h2>{service ? 'Editar servicio' : 'Nuevo servicio'}</h2>
      <p className="muted">
        Cada opción cobrable tiene su propia ficha y tarifa. Los cambios se aplican a nuevas
        selecciones.
      </p>
      <form className="stack" onSubmit={(event) => void form.handleSubmit(save)(event)}>
        <div className="form-grid">
          <label className="field">
            Nombre
            <input {...form.register('name')} autoFocus />
            {form.formState.errors.name ? (
              <span className="error">{form.formState.errors.name.message}</span>
            ) : null}
          </label>
          <label className="field">
            Categoría o subcategoría
            <select
              {...form.register('category_id', {
                onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                  if (!service) {
                    const suggestion = categories.find(
                      (item) => item.id === event.target.value,
                    )?.default_price_mode;
                    if (suggestion) form.setValue('price_mode', suggestion, { shouldDirty: true });
                  }
                },
              })}
            >
              <option value="">Seleccionar</option>
              {categories
                .filter((item) => item.active || item.id === service?.category_id)
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
            Tipo de ficha
            <select {...form.register('form_type')}>
              <option value="general">General</option>
              <option value="color">Color · cinco vistas</option>
              <option value="keratin">Keratina</option>
            </select>
          </label>
          <label className="field">
            Precio
            <select {...form.register('price_mode')}>
              <option value="custom">Personalizado · en cada visita</option>
              <option value="fixed">Fijo · tarifa del catálogo</option>
            </select>
          </label>
          {mode === 'fixed' ? (
            <label className="field">
              Tarifa fija · COP
              <input
                inputMode="numeric"
                placeholder="Pendiente"
                {...form.register('fixed_price')}
              />
              {form.formState.errors.fixed_price ? (
                <span className="error">{form.formState.errors.fixed_price.message}</span>
              ) : (
                <small>Pesos enteros. Sin importe, debe permanecer inactivo.</small>
              )}
            </label>
          ) : (
            <p className="muted">
              Se define en cada visita. Un precio pendiente no equivale a cero.
            </p>
          )}
          <label className="field">
            Duración sugerida · minutos
            <input inputMode="numeric" {...form.register('duration_minutes')} />
            {form.formState.errors.duration_minutes ? (
              <span className="error">{form.formState.errors.duration_minutes.message}</span>
            ) : null}
          </label>
          <label className="field">
            Orden en el catálogo
            <input inputMode="numeric" {...form.register('sort_order')} />
          </label>
        </div>
        <label className="actions">
          <input type="checkbox" {...form.register('active')} /> Disponible para nuevas atenciones
        </label>
        <OperationFeedback error={operation.error} success={operation.success} />
        <div className="actions">
          <button className="button" disabled={operation.pending}>
            {operation.pending ? 'Guardando…' : 'Guardar servicio'}
          </button>
          <button className="button-secondary" type="button" onClick={onClose}>
            Cerrar editor
          </button>
          {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
        </div>
      </form>
    </section>
  );
}
