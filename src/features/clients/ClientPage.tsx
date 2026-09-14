import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, FileText, Pencil } from 'lucide-react';
import { useTypedQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateLabel } from '../../lib/format';
import { Loading, ErrorState, Empty } from '../../components/Feedback';
import { ActionButton } from '../../components/ActionButton';
import ClientEditor from './ClientEditor';
import ExportButton from '../exports/ExportButton';
const TechnicalForm = lazy(() => import('../technical/TechnicalForm'));
export default function ClientPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const q = useTypedQuery('client', { id });
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (q.isPending) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const { client, history } = q.data;
  return (
    <>
      <Link to="/clientas" className="actions small muted">
        <ArrowLeft size={16} />
        Volver a clientas
      </Link>
      <div className="page-header" style={{ marginTop: 22 }}>
        <div>
          <h1>{client.name}</h1>
          <p>
            {client.phone || 'Sin teléfono'} ·{' '}
            {client.birth_day
              ? `Cumpleaños ${client.birth_day}/${client.birth_month}`
              : 'Cumpleaños sin registrar'}
          </p>
        </div>
        <div className="actions">
          <button className="button-secondary" onClick={() => setEdit(!edit)}>
            <Pencil size={17} />
            Editar datos
          </button>
          <ActionButton
            action="visit.create"
            payload={{ client_id: client.id, professional_id: profile?.id }}
            disabled={!client.active}
            onSuccess={(r) => navigate(`/visitas/${String(r.id ?? r.visit_id)}`)}
          >
            <Plus size={17} />
            Iniciar visita
          </ActionButton>
        </div>
      </div>
      {edit ? (
        <div className="card">
          <ClientEditor
            client={client}
            onCancel={() => setEdit(false)}
            onSaved={() => setEdit(false)}
          />
        </div>
      ) : (
        <div className="split-content">
          <section className="card">
            <div className="section-title">
              <h2>Historial de atenciones</h2>
              <FileText size={21} className="muted" />
            </div>
            {!history.length ? (
              <Empty title="Una historia por escribir">
                <p>Las fichas técnicas de sus visitas aparecerán aquí.</p>
              </Empty>
            ) : (
              history.map((h) => (
                <article className="history-row" key={h.visit_id}>
                  <span className="small muted">
                    {dateLabel(h.starts_at)} · {h.professional_name}
                  </span>
                  <h3>{h.services.map((s) => s.name).join(' + ')}</h3>
                  <div className="actions">
                    <button
                      className="button-secondary"
                      onClick={() => setExpanded(expanded === h.visit_id ? null : h.visit_id)}
                    >
                      Consultar fichas
                    </button>
                    {(profile?.role === 'owner' || h.professional_id === profile?.id) && (
                      <Link to={`/visitas/${h.visit_id}`} className="text-link small">
                        Abrir visita y cuenta
                      </Link>
                    )}
                  </div>
                  {expanded === h.visit_id &&
                    h.services.map((s) => (
                      <div className="technical-preview" key={s.id}>
                        <h3>{s.name}</h3>
                        <Suspense fallback={<Loading />}>
                          <TechnicalForm
                            kind={s.form_type}
                            value={s.technical}
                            onChange={() => undefined}
                            readOnly
                          />
                        </Suspense>
                      </div>
                    ))}
                </article>
              ))
            )}
          </section>
          <aside className="stack">
            <div className="card">
              <h3>Detalles para cuidarla</h3>
              <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                {client.notes || 'Sin observaciones registradas.'}
              </p>
            </div>
            <div className="card">
              <h3>Datos personales</h3>
              <p className="small muted">
                {client.consent || 'Sin constancia de autorización registrada.'}
              </p>
              <span className="badge">{client.active ? 'Clienta activa' : 'Archivada'}</span>
              {profile?.role === 'owner' && (
                <>
                  <p className="small muted">
                    La exportación incluye todas sus fichas, citas, cuentas y pagos. Guárdala en un
                    lugar privado.
                  </p>
                  <ExportButton scope="client" clientId={client.id} />
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
