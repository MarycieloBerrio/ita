import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { FolderTree, Plus } from 'lucide-react';
import {
  categoryContains,
  categoryPath,
  OperationFeedback,
  useOperation,
  type Category,
} from './operations';

const schema = z.object({
  name: z.string().trim().min(1, 'Escribe un nombre.').max(100),
  parent_id: z.string(),
  active: z.boolean(),
  sort_order: z.string().regex(/^\d+$/, 'Utiliza un orden entero.'),
  default_price_mode: z.enum(['', 'fixed', 'custom']),
});
type Values = z.infer<typeof schema>;

export default function CategoryManager({
  categories,
  catalog,
}: {
  categories: Category[];
  catalog: 'services' | 'inventory';
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [opened, setOpened] = useState(false);
  const operation = useOperation();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      parent_id: '',
      active: true,
      sort_order: '0',
      default_price_mode: '',
    },
  });
  function edit(category: Category | null) {
    setEditing(category);
    form.reset({
      name: category?.name ?? '',
      parent_id: category?.parent_id ?? '',
      active: category?.active ?? true,
      sort_order: String(category?.sort_order ?? 0),
      default_price_mode: category?.default_price_mode ?? '',
    });
    operation.clear();
    setOpened(true);
  }
  async function save(values: Values) {
    const result = await operation.run('category.save', {
      ...values,
      id: editing?.id,
      version: editing?.version,
      kind: catalog === 'services' ? 'service' : 'product',
      parent_id: values.parent_id || null,
      sort_order: Number(values.sort_order),
      default_price_mode: values.default_price_mode || null,
    });
    if (result !== undefined) {
      setOpened(false);
      form.reset(values);
    }
  }
  return (
    <section className="card stack">
      <div className="actions">
        <h2 className="section-title">
          <FolderTree size={20} aria-hidden="true" /> Categorías y subcategorías
        </h2>
        <button className="button-secondary" onClick={() => edit(null)}>
          <Plus size={18} aria-hidden="true" /> Crear categoría
        </button>
      </div>
      <p className="muted">
        Las categorías organizan el catálogo. Reubicar conserva las operaciones anteriores. Para
        archivar una agrupación, primero reubica o archiva sus elementos activos.
      </p>
      <OperationFeedback error={operation.error} success={operation.success} />
      {opened ? (
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
              Dentro de
              <select {...form.register('parent_id')}>
                <option value="">Nivel principal</option>
                {categories
                  .filter(
                    (item) =>
                      item.active &&
                      (!editing || !categoryContains(categories, editing.id, item.id)),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {categoryPath(categories, item.id)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Orden
              <input inputMode="numeric" {...form.register('sort_order')} />
            </label>
            {catalog === 'services' ? (
              <label className="field">
                Modalidad sugerida para nuevos servicios
                <select {...form.register('default_price_mode')}>
                  <option value="">Sin sugerencia</option>
                  <option value="fixed">Fijo</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
            ) : null}
          </div>
          <label className="actions">
            <input type="checkbox" {...form.register('active')} /> Activa para nuevas selecciones
          </label>
          <div className="actions">
            <button className="button" disabled={operation.pending}>
              {operation.pending ? 'Guardando…' : 'Guardar categoría'}
            </button>
            <button type="button" className="button-secondary" onClick={() => setOpened(false)}>
              Cancelar
            </button>
            {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
          </div>
          {editing ? (
            <details>
              <summary>Eliminar categoría vacía y nunca utilizada</summary>
              <p>
                Si tiene elementos o registros históricos, el servidor rechazará la eliminación.
                Puedes archivarla en su lugar.
              </p>
              <button
                type="button"
                className="button-danger"
                disabled={operation.pending}
                onClick={() => {
                  void operation
                    .run(
                      'category.delete',
                      { id: editing.id, version: editing.version },
                      'Categoría vacía eliminada',
                    )
                    .then((result) => {
                      if (result !== undefined) setOpened(false);
                    });
                }}
              >
                Eliminar categoría vacía
              </button>
            </details>
          ) : null}
        </form>
      ) : null}
      {categories.length === 0 ? (
        <p className="empty">Aún no hay categorías. Crea la organización que usa tu salón.</p>
      ) : (
        <ul className="category-list">
          {[...categories]
            .sort((a, b) =>
              categoryPath(categories, a.id).localeCompare(categoryPath(categories, b.id), 'es'),
            )
            .map((category) => (
              <li key={category.id}>
                <span>
                  {categoryPath(categories, category.id)}{' '}
                  {!category.active ? <span className="badge">Archivada</span> : null}
                </span>
                <button className="button-secondary" onClick={() => edit(category)}>
                  Editar / reubicar
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
