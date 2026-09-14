import { useState } from 'react';
import type { PaymentMethod } from '../../lib/contracts';
import { OperationFeedback, useOperation } from '../catalog/operations';

export default function PaymentMethods({ methods }: { methods: PaymentMethod[] }) {
  const operation = useOperation();
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [name, setName] = useState('');
  const [cash, setCash] = useState(false);
  const [active, setActive] = useState(true);
  function edit(method: PaymentMethod | null) {
    setEditing(method);
    setName(method?.name ?? '');
    setCash(method?.is_cash ?? false);
    setActive(method?.active ?? true);
    operation.clear();
  }
  async function save() {
    if (!name.trim()) {
      operation.setError('Escribe el nombre del método de pago.');
      return;
    }
    const result = await operation.run('payment_method.save', {
      id: editing?.id,
      version: editing?.version,
      name: name.trim(),
      is_cash: cash,
      active,
    });
    if (result !== undefined) {
      setEditing(null);
      setName('');
      setCash(false);
      setActive(true);
    }
  }
  return (
    <section className="card stack">
      <h2>Métodos de pago</h2>
      <p className="muted">
        Configura los medios que realmente usa el salón. Marca «Efectivo» únicamente si el dinero
        entra o sale del cajón. Los registros anteriores conservan su método histórico.
      </p>
      {methods.length === 0 ? (
        <p className="empty">
          Sin métodos configurados. Añade uno para registrar cobros y egresos.
        </p>
      ) : (
        <ul className="category-list">
          {methods.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.name}</strong> · {item.is_cash ? 'Efectivo en caja' : 'Fuera de caja'}{' '}
                {!item.active ? <span className="badge">Archivado</span> : null}
              </span>
              <button className="button-secondary" onClick={() => edit(item)}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{editing ? 'Editar método' : 'Añadir método'}</h3>
        <label className="field">
          Nombre
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label className="actions">
          <input
            type="checkbox"
            checked={cash}
            onChange={(event) => setCash(event.target.checked)}
          />{' '}
          Efectivo que entra o sale de caja
        </label>
        <label className="actions">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />{' '}
          Activo para nuevos registros
        </label>
        <OperationFeedback error={operation.error} success={operation.success} />
        <div className="actions">
          <button className="button" disabled={operation.pending}>
            {operation.pending ? 'Guardando…' : 'Guardar método'}
          </button>
          {editing ? (
            <button className="button-secondary" type="button" onClick={() => edit(null)}>
              Cancelar edición
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
