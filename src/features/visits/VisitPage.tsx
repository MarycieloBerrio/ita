import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Check, Copy } from 'lucide-react';
import { useTypedQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useOperation } from '../../lib/useOperation';
import { dateLabel, money, statusLabel } from '../../lib/format';
import { Loading, ErrorState, Empty } from '../../components/Feedback';
import { ActionButton } from '../../components/ActionButton';
import ServicePicker from './ServicePicker';
import ServiceEditor from './ServiceEditor';
import VisitSales from './VisitSales';
import AccountCard from './AccountCard';
import Dialog from '../../components/Dialog';
function CopyPrevious({
  clientId,
  visitId,
  version,
  onClose,
}: {
  clientId: string;
  visitId: string;
  version: number;
  onClose: () => void;
}) {
  const history = useTypedQuery('client', { id: clientId, limit: 50 });
  return (
    <section className="stack">
      <div className="section-title">
        <h2>Copiar ficha como referencia</h2>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar historial">
          ×
        </button>
      </div>
      <p className="small muted">
        Revisa productos y fórmulas. Se crea un borrador nuevo, sin precio personalizado, pagos ni
        ventas anteriores.
      </p>
      {history.data?.history
        .filter((v) => v.visit_id !== visitId)
        .map((v) => (
          <div key={v.visit_id}>
            <h3>{dateLabel(v.starts_at)}</h3>
            {v.services.map((s) => (
              <div className="account-row" key={s.id}>
                <span>{s.name}</span>
                <ActionButton
                  action="service.copy"
                  payload={{ source_id: s.id, visit_id: visitId, version }}
                  className="button-secondary"
                  onSuccess={onClose}
                >
                  Copiar ficha
                </ActionButton>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
export default function VisitPage() {
  const { id } = useParams();
  const { profile, bootstrap } = useAuth();
  const request = useTypedQuery('visit', { id });
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const setFormDirty = useCallback((value: boolean) => setDirty(value), []);
  const [notes, setNotes] = useState<string | null>(null);
  const [professional, setProfessional] = useState('');
  const [reason, setReason] = useState('');
  const operation = useOperation();
  if (request.isPending) return <Loading />;
  if (request.error || !request.data)
    return <ErrorState error={request.error} retry={() => void request.refetch()} />;
  const detail = request.data;
  const { visit, services } = detail;
  const active = services.find((s) => s.id === selected) ?? services[0];
  const closed = ['completed', 'void'].includes(visit.status);
  return (
    <>
      <Link className="actions small muted" to={`/clientas/${visit.client_id}`}>
        <ArrowLeft size={16} />
        Historia de {visit.client_name}
      </Link>
      <div className="page-header" style={{ marginTop: 22 }}>
        <div>
          <p className="eyebrow">{dateLabel(visit.starts_at)}</p>
          <h1>{visit.client_name}</h1>
          <p>
            {bootstrap?.profiles.find((p) => p.id === visit.professional_id)?.display_name ??
              'Profesional responsable'}{' '}
            · <span className="badge">{statusLabel[visit.status]}</span>
          </p>
        </div>
        {!closed && (
          <ActionButton
            action="visit.close"
            payload={{ id: visit.id, version: visit.version }}
            disabled={dirty}
            confirm="¿Cerrar esta visita? Se comprobarán todas las fichas, precios y entregas. Puede quedar saldo pendiente."
          >
            <Check size={18} />
            Cerrar visita
          </ActionButton>
        )}
      </div>
      <div className="split-content">
        <div className="stack">
          <div className="section-title">
            <h2>Servicios de esta visita</h2>
            {!closed && (
              <div className="actions">
                <button
                  className="button-secondary"
                  disabled={dirty}
                  onClick={() => setCopying(true)}
                >
                  <Copy size={16} />
                  Copiar ficha
                </button>
                <button
                  className="button-secondary"
                  disabled={dirty}
                  onClick={() => setAdding(true)}
                >
                  <Plus size={17} />
                  Añadir servicio
                </button>
              </div>
            )}
          </div>
          <div className="visit-tabs" role="tablist" aria-label="Servicios de esta visita">
            {services.map((s) => (
              <button
                className={`visit-tab ${s.id === active?.id ? 'active' : ''}`}
                key={s.id}
                role="tab"
                aria-selected={s.id === active?.id}
                disabled={dirty && s.id !== active?.id}
                onClick={() => setSelected(s.id)}
              >
                {s.name}
                <small>
                  {money(s.price)} · {s.status === 'completed' ? 'Finalizado' : 'Borrador'}
                </small>
              </button>
            ))}
          </div>
          {!services.length ? (
            <div className="card">
              <Empty title="Una visita, todos sus servicios">
                <p>
                  Añade Color, Keratina, servicios generales o una tanda de depilación. Cada uno
                  tendrá su propia ficha y compartirán la cuenta.
                </p>
              </Empty>
            </div>
          ) : (
            active && (
              <ServiceEditor
                key={active.id}
                service={active}
                sales={detail.sales}
                onDirty={setFormDirty}
              />
            )
          )}
          <VisitSales detail={detail} />
          <details className="card">
            <summary>Datos de la visita y correcciones</summary>
            <div className="stack" style={{ marginTop: 20 }}>
              <label className="field">
                Notas generales
                <textarea
                  value={notes ?? visit.notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={closed}
                />
              </label>
              {profile?.role === 'owner' && (
                <>
                  <label className="field">
                    Profesional responsable
                    <select
                      value={professional || visit.professional_id}
                      onChange={(e) => setProfessional(e.target.value)}
                      disabled={closed}
                    >
                      {bootstrap?.profiles
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Motivo de corrección o reasignación
                    <input value={reason} onChange={(e) => setReason(e.target.value)} />
                  </label>
                </>
              )}
              {operation.error && (
                <p className="error" role="alert">
                  {operation.error}
                </p>
              )}
              {!closed && (
                <button
                  className="button-secondary"
                  disabled={operation.pending || dirty}
                  onClick={() =>
                    void operation.run('visit.save', {
                      id: visit.id,
                      version: visit.version,
                      notes: notes ?? visit.notes,
                      ...(professional ? { professional_id: professional, reason } : {}),
                    })
                  }
                >
                  Guardar datos de visita
                </button>
              )}
              {profile?.role === 'owner' && visit.status !== 'void' && (
                <ActionButton
                  action="visit.void"
                  payload={{ id: visit.id, version: visit.version, reason }}
                  disabled={!reason.trim() || dirty}
                  className="button-danger"
                  confirm="Anular por error de registro conserva trazabilidad y no devuelve pagos ni repone existencias. ¿Confirmar?"
                >
                  Anular por error de registro
                </ActionButton>
              )}
            </div>
          </details>
        </div>
        <AccountCard detail={detail} />
      </div>
      {(adding || copying) && (
        <Dialog
          title={adding ? 'Añadir servicios' : 'Copiar ficha'}
          onClose={() => {
            setAdding(false);
            setCopying(false);
          }}
        >
          {adding ? (
            <ServicePicker visit={visit} onClose={() => setAdding(false)} />
          ) : (
            <CopyPrevious
              clientId={visit.client_id}
              visitId={visit.id}
              version={visit.version}
              onClose={() => setCopying(false)}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
