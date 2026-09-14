import { useState } from 'react';
import { useTypedQuery } from '../../lib/api';
import { useOperation } from '../../lib/useOperation';
import { money } from '../../lib/format';
import type { Visit } from '../../lib/contracts';
import { MaterialFields } from '../technical/MaterialFields';
import type { MaterialGroup } from '../technical/types';
import { Loading, ErrorState } from '../../components/Feedback';
export default function ServicePicker({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const catalog = useTypedQuery('catalog');
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [batch, setBatch] = useState(false);
  const [groupId] = useState(() => crypto.randomUUID());
  const [materials, setMaterials] = useState<MaterialGroup>({ none: true, items: [] });
  const [notes, setNotes] = useState('');
  const operation = useOperation();
  const list =
    catalog.data?.services.filter((s) => s.active && (!category || s.category_id === category)) ??
    [];
  const subtotal = list
    .filter((s) => selected.includes(s.id))
    .reduce((sum, s) => sum + (s.fixed_price ?? 0), 0);
  const pending = list.filter((s) => selected.includes(s.id) && s.price_mode === 'custom').length;
  return (
    <div className="stack">
      <div className="section-title">
        <h2>Añadir servicios</h2>
        <button className="icon-button" aria-label="Cerrar selección" onClick={onClose}>
          ×
        </button>
      </div>
      {catalog.isPending && <Loading />}
      {catalog.error && <ErrorState error={catalog.error} />}
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={batch}
          onChange={(e) => {
            setBatch(e.target.checked);
            setSelected([]);
            setCategory('');
          }}
        />
        Añadir una tanda de depilación
      </label>
      <label className="field">
        {batch ? 'Método de depilación' : 'Categoría o subcategoría'}
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSelected([]);
          }}
        >
          <option value="">{batch ? 'Selecciona el método' : 'Todas'}</option>
          {catalog.data?.categories
            .filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {batch && (
        <p className="notice">
          Elige el método, marca las zonas y revisa sus precios. Cada zona genera su propio cargo.
        </p>
      )}
      <div className="service-select-list">
        {list
          .filter((s) => !batch || (Boolean(category) && s.form_type === 'general'))
          .map((s) => (
            <label className="service-choice" key={s.id}>
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id),
                  )
                }
              />
              <span>
                <strong>{s.name}</strong>
                <small>{s.path}</small>
              </span>
              <span className="small">{money(s.fixed_price)}</span>
            </label>
          ))}
      </div>
      {!list.length && (
        <p className="muted">
          No hay servicios activos. La dueña puede completar el catálogo en Servicios y precios.
        </p>
      )}
      {batch && (
        <MaterialFields
          label="Materiales comunes de la tanda"
          value={materials}
          onChange={setMaterials}
          noneLabel="Sin materiales"
        />
      )}
      {batch && (
        <label className="field">
          Notas comunes (opcional)
          <textarea maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <small>
            Esta anotación se guarda en cada zona de la tanda y no descuenta inventario.
          </small>
        </label>
      )}
      <div className="account-total">
        <span>Subtotal conocido</span>
        <strong>{money(subtotal)}</strong>
      </div>
      {pending > 0 && (
        <p className="small muted">{pending} precio(s) por definir en la atención.</p>
      )}
      {operation.error && (
        <p className="error" role="alert">
          {operation.error}
        </p>
      )}
      <button
        className="button"
        disabled={!selected.length || operation.pending}
        onClick={() => {
          void operation
            .run('service.add', {
              visit_id: visit.id,
              version: visit.version,
              service_ids: selected,
              ...(batch
                ? {
                    group_id: groupId,
                    technical: {
                      kind: 'general',
                      schemaVersion: 1,
                      materials,
                      notes,
                    },
                  }
                : {}),
            })
            .then((r) => {
              if (r) onClose();
            });
        }}
      >
        {operation.pending ? 'Añadiendo…' : batch ? 'Añadir tanda' : 'Añadir a la visita'}
      </button>
    </div>
  );
}
