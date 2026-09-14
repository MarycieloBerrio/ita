import { Plus, Trash2 } from 'lucide-react';
import type { Material, MaterialGroup, Oxidant } from './types';

export function TextField({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
  multiline = false,
  limit = 1000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  limit?: number;
}) {
  return (
    <label className="ita-technical-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={value.length > limit}
        />
      ) : (
        <input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={value.length > limit}
        />
      )}
      {value.length > limit && (
        <small role="alert" className="ita-technical-error">
          Supera el límite de {limit.toLocaleString('es-CO')} caracteres. El texto se conserva para
          que puedas revisarlo.
        </small>
      )}
    </label>
  );
}

function MaterialRow({
  item,
  onChange,
  onRemove,
  readOnly,
  oxidant,
}: {
  item: Material | Oxidant;
  onChange: (value: Material | Oxidant) => void;
  onRemove: () => void;
  readOnly: boolean;
  oxidant: boolean;
}) {
  function remove() {
    if (
      [item.name, item.reference, item.details].some((value) => value.trim()) &&
      !window.confirm('¿Quitar este producto de la ficha? No modifica el inventario.')
    )
      return;
    onRemove();
  }
  return (
    <div className="ita-material-row">
      <div className="ita-technical-field-grid">
        <TextField
          label="Producto"
          value={item.name}
          onChange={(name) => onChange({ ...item, name })}
          disabled={readOnly}
        />
        <TextField
          label="Marca / referencia"
          value={item.reference}
          onChange={(reference) => onChange({ ...item, reference })}
          disabled={readOnly}
        />
        {oxidant && 'phase' in item && (
          <>
            <TextField
              label="Fase / mezcla"
              value={item.phase}
              placeholder="Ej.: decoloración, mezcla 1"
              onChange={(phase) => onChange({ ...item, phase })}
              disabled={readOnly}
            />
            <TextField
              label="Concentración (% o volúmenes)"
              value={item.concentration}
              placeholder="Ej.: 6 % o 20 volúmenes"
              onChange={(concentration) => onChange({ ...item, concentration })}
              disabled={readOnly}
            />
          </>
        )}
      </div>
      <TextField
        label="Cantidad, proporción, tiempo u otra indicación (opcional)"
        value={item.details}
        onChange={(details) => onChange({ ...item, details })}
        disabled={readOnly}
        multiline
        limit={3000}
      />
      {!readOnly && (
        <button type="button" className="ita-technical-button ita-technical-quiet" onClick={remove}>
          <Trash2 size={16} /> Quitar producto
        </button>
      )}
    </div>
  );
}

type GroupProps = {
  label: string;
  value: MaterialGroup | { none: boolean; items: Oxidant[] };
  onChange: (value: { none: boolean; items: (Material | Oxidant)[] }) => void;
  readOnly?: boolean;
  oxidant?: boolean;
  noneLabel?: string;
};

export function MaterialFields({
  label,
  value,
  onChange,
  readOnly = false,
  oxidant = false,
  noneLabel = 'No se utilizó',
}: GroupProps) {
  function add() {
    const common = { id: crypto.randomUUID(), name: '', reference: '', details: '' };
    const item = oxidant ? { ...common, phase: '', concentration: '' } : common;
    onChange({ none: false, items: [...value.items, item] });
  }
  return (
    <section className="ita-material-group">
      <div className="ita-technical-heading">
        <h4>{label}</h4>
        <label className="ita-technical-check">
          <input
            type="checkbox"
            checked={value.none}
            disabled={readOnly || value.items.length > 0}
            onChange={(event) => onChange({ ...value, none: event.target.checked })}
          />
          {noneLabel}
        </label>
      </div>
      {!value.none && (
        <>
          {value.items.map((item) => (
            <MaterialRow
              key={item.id}
              item={item}
              readOnly={readOnly}
              oxidant={oxidant}
              onChange={(next) =>
                onChange({
                  none: false,
                  items: value.items.map((entry) => (entry.id === item.id ? next : entry)),
                })
              }
              onRemove={() =>
                onChange({
                  none: false,
                  items: value.items.filter((entry) => entry.id !== item.id),
                })
              }
            />
          ))}
          {!value.items.length && (
            <p className="ita-technical-hint">
              Registra el producto utilizado o marca «{noneLabel}».
            </p>
          )}
        </>
      )}
      {!readOnly && value.items.length < 40 && (
        <button type="button" className="ita-technical-button" onClick={add}>
          <Plus size={17} />
          {value.items.length ? 'Añadir otro producto' : 'Añadir producto'}
        </button>
      )}
    </section>
  );
}
