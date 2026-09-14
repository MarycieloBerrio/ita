import { useId } from 'react';
import { Check, FlaskConical, ShoppingBag } from 'lucide-react';
import { ColorMapEditor } from './ColorMapEditor';
import { MaterialFields, TextField } from './MaterialFields';
import {
  technicalDataSchema,
  type ColorData,
  type KeratinData,
  type LinkedSale,
  type MaterialGroup,
  type Oxidant,
  type TechnicalData,
  type TechnicalKind,
} from './types';
import './technical.css';

export type TechnicalFormProps = {
  kind: TechnicalKind;
  value: TechnicalData;
  onChange: (value: TechnicalData) => void;
  readOnly?: boolean;
  sales?: LinkedSale[];
  onPendingChange?: (pending: boolean) => void;
};

function SaleLinks({
  value,
  onChange,
  readOnly,
  sales,
}: {
  value: ColorData | KeratinData;
  onChange: (value: ColorData | KeratinData) => void;
  readOnly: boolean;
  sales: LinkedSale[];
}) {
  const name = useId();
  return (
    <section className="ita-material-group">
      <div className="ita-technical-heading">
        <h4>
          <ShoppingBag size={19} /> Productos vendidos
        </h4>
      </div>
      <p className="ita-technical-hint">
        Añade el producto a la cuenta de esta visita y vincúlalo aquí. La entrega se confirma en la
        cuenta.
      </p>
      <div className="ita-sale-choices">
        <label className="ita-technical-check">
          <input
            type="radio"
            name={name}
            checked={value.saleDisposition === 'none'}
            disabled={readOnly}
            onChange={() => onChange({ ...value, saleDisposition: 'none', saleIds: [] })}
          />
          No se vendieron productos
        </label>
        <label className="ita-technical-check">
          <input
            type="radio"
            name={name}
            checked={value.saleDisposition === 'linked'}
            disabled={readOnly}
            onChange={() => onChange({ ...value, saleDisposition: 'linked' })}
          />
          Vincular productos de la visita
        </label>
      </div>
      {value.saleDisposition === 'pending' && (
        <p className="ita-technical-hint">Pendiente de definir al completar la ficha.</p>
      )}
      {value.saleDisposition === 'linked' && (
        <div className="ita-sale-links">
          {sales.length === 0 && <p>Todavía no hay líneas de productos en esta visita.</p>}
          {sales.map((sale) => (
            <label key={sale.id} className="ita-sale-line">
              <input
                type="checkbox"
                disabled={
                  readOnly ||
                  sale.status === 'discarded' ||
                  sale.status === 'cancelled' ||
                  sale.status === 'voided'
                }
                checked={value.saleIds.includes(sale.id)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    saleIds: event.target.checked
                      ? [...value.saleIds, sale.id]
                      : value.saleIds.filter((id) => id !== sale.id),
                  })
                }
              />
              <span>{sale.name}</span>
              <small>
                {sale.status === 'confirmed' ? (
                  <>
                    <Check size={14} /> Entrega confirmada
                  </>
                ) : sale.status === 'discarded' ||
                  sale.status === 'cancelled' ||
                  sale.status === 'voided' ? (
                  'Descartado'
                ) : (
                  'Entrega pendiente'
                )}
              </small>
            </label>
          ))}
          {value.saleIds
            .filter((id) => !sales.some((sale) => sale.id === id))
            .map((id) => (
              <p key={id} className="ita-technical-hint">
                Línea vinculada: {id}. Consulta su estado en la cuenta de la visita.
              </p>
            ))}
        </div>
      )}
    </section>
  );
}

function HairExtras({
  value,
  onChange,
  readOnly,
}: {
  value: ColorData | KeratinData;
  onChange: (value: ColorData | KeratinData) => void;
  readOnly: boolean;
}) {
  return (
    <details className="ita-hair-extras">
      <summary>Tratamiento y seguimiento opcionales</summary>
      <div className="ita-extra-fields">
        <TextField
          label="Tratamiento aplicado"
          value={value.treatment}
          onChange={(treatment) => onChange({ ...value, treatment })}
          disabled={readOnly}
          multiline
          limit={3000}
        />
        <TextField
          label="Recomendación para casa"
          value={value.homeRecommendation}
          onChange={(homeRecommendation) => onChange({ ...value, homeRecommendation })}
          disabled={readOnly}
          multiline
          limit={3000}
        />
        <label className="ita-technical-field">
          <span>Fecha sugerida de mantenimiento</span>
          <input
            type="date"
            value={value.maintenanceDate}
            disabled={readOnly}
            onChange={(event) => onChange({ ...value, maintenanceDate: event.target.value })}
          />
        </label>
        <p className="ita-technical-hint">
          La recomendación y la fecha se conservan en el historial.
        </p>
      </div>
    </details>
  );
}

export function TechnicalForm({
  kind,
  value,
  onChange,
  readOnly = false,
  sales = [],
  onPendingChange,
}: TechnicalFormProps) {
  if (value.kind !== kind || value.schemaVersion !== 1)
    return (
      <div className="ita-technical-error" role="alert">
        El tipo o la versión de esta ficha no es compatible. Recarga la atención para conservar sus
        datos.
      </div>
    );
  const shape = technicalDataSchema.safeParse(value);
  const structuralError =
    !shape.success &&
    shape.error.issues.some(
      (issue) => issue.code !== 'too_big' && issue.path[0] !== 'maintenanceDate',
    );
  if (structuralError)
    return (
      <div className="ita-technical-error" role="alert">
        La estructura de esta ficha no es compatible. Sus datos se han conservado; revisa la versión
        antes de editar.
      </div>
    );
  return (
    <div className="ita-technical-form">
      {value.kind === 'color' && (
        <>
          <ColorMapEditor
            value={value.map}
            onChange={(map) => onChange({ ...value, map })}
            readOnly={readOnly}
            onPendingChange={onPendingChange}
          />
          <section className="ita-procedure">
            <TextField
              label="Procedimiento realizado"
              value={value.procedure}
              onChange={(procedure) => onChange({ ...value, procedure })}
              disabled={readOnly}
              multiline
              limit={10000}
              placeholder="Describe el paso a paso, las mezclas y los tiempos del trabajo."
            />
            <p className="ita-character-count">
              {value.procedure.length.toLocaleString('es-CO')} / 10.000 caracteres
            </p>
          </section>
          <div className="ita-technical-heading">
            <h3>
              <FlaskConical size={21} /> Productos del trabajo
            </h3>
          </div>
          <p className="ita-material-note">
            Anotar productos usados documenta el trabajo. No descuenta unidades del inventario.
          </p>
          <MaterialFields
            label="Decolorante"
            value={value.decolorants}
            onChange={(decolorants) =>
              onChange({ ...value, decolorants: decolorants as MaterialGroup })
            }
            readOnly={readOnly}
          />
          <MaterialFields
            label="Peróxido / oxidante"
            value={value.oxidants}
            onChange={(oxidants) =>
              onChange({
                ...value,
                oxidants: { none: oxidants.none, items: oxidants.items as Oxidant[] },
              })
            }
            readOnly={readOnly}
            oxidant
          />
          <MaterialFields
            label="Color · tinte, tono o fórmula"
            value={value.tints}
            onChange={(tints) => onChange({ ...value, tints: tints as MaterialGroup })}
            readOnly={readOnly}
            noneLabel="Sin tinte aplicado"
          />
          <MaterialFields
            label="Finalizador"
            value={value.finalizers}
            onChange={(finalizers) =>
              onChange({ ...value, finalizers: finalizers as MaterialGroup })
            }
            readOnly={readOnly}
          />
        </>
      )}
      {value.kind === 'keratin' && (
        <>
          <div className="ita-technical-heading">
            <div>
              <h3>Ficha de keratina</h3>
              <p>El sistema utilizado y las indicaciones de este trabajo.</p>
            </div>
          </div>
          <section className="ita-material-group">
            <h4>Producto / sistema utilizado</h4>
            <div className="ita-technical-field-grid">
              <TextField
                label="Nombre del producto / sistema"
                value={value.product.name}
                onChange={(name) => onChange({ ...value, product: { ...value.product, name } })}
                disabled={readOnly}
              />
              <TextField
                label="Marca / referencia"
                value={value.product.reference}
                onChange={(reference) =>
                  onChange({ ...value, product: { ...value.product, reference } })
                }
                disabled={readOnly}
              />
            </div>
            <TextField
              label="Componentes (si aplica)"
              value={value.product.components}
              onChange={(components) =>
                onChange({ ...value, product: { ...value.product, components } })
              }
              disabled={readOnly}
              multiline
              limit={3000}
            />
            <p className="ita-material-note">
              El producto utilizado se documenta sin descontar unidades del inventario.
            </p>
          </section>
          <TextField
            label="Procedimiento (opcional)"
            value={value.procedure}
            onChange={(procedure) => onChange({ ...value, procedure })}
            disabled={readOnly}
            multiline
            limit={10000}
          />
        </>
      )}
      {value.kind === 'general' && (
        <>
          <div className="ita-technical-heading">
            <div>
              <h3>Ficha del servicio</h3>
              <p>Registra únicamente los materiales y observaciones que necesites.</p>
            </div>
          </div>
          <MaterialFields
            label="Materiales usados (opcionales)"
            value={value.materials}
            onChange={(materials) => onChange({ ...value, materials: materials as MaterialGroup })}
            readOnly={readOnly}
            noneLabel="Sin materiales"
          />
          <p className="ita-material-note">
            Los materiales anotados no descuentan inventario ni crean cargos.
          </p>
        </>
      )}
      {value.kind !== 'general' && (
        <>
          <SaleLinks value={value} onChange={onChange} readOnly={readOnly} sales={sales} />
          <HairExtras value={value} onChange={onChange} readOnly={readOnly} />
        </>
      )}
      <TextField
        label="Observaciones (opcional)"
        value={value.notes}
        onChange={(notes) => onChange({ ...value, notes })}
        disabled={readOnly}
        multiline
        limit={10000}
      />
    </div>
  );
}

export default TechnicalForm;
export {
  createTechnicalData,
  validateTechnicalCompletion,
  copyTechnicalData,
  technicalDataSchema,
} from './types';
export type { TechnicalData } from './types';
