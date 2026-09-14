import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Plus,
  Flower2,
  CalendarDays,
  UsersRound,
  Scissors,
  Package,
  Clock3,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useTypedQuery } from '../../lib/api';
import { money, bogotaDate, statusLabel } from '../../lib/format';
import { Loading, ErrorState, Empty } from '../../components/Feedback';
import BirthdayNotice from './BirthdayNotice';
function OwnerStats() {
  const date = bogotaDate();
  const finance = useTypedQuery('finance', { from: date, to: date });
  const inventory = useTypedQuery('inventory');
  return (
    <>
      <div className="stat-card card">
        <div>
          <p>SALDOS PENDIENTES</p>
          <strong>{finance.data ? money(finance.data.totals.balance) : '—'}</strong>
          <small className="muted">Cuentas por cobrar</small>
        </div>
        <span className="stat-icon">
          <Scissors size={20} />
        </span>
      </div>
      <div className="stat-card card">
        <div>
          <p>PRODUCTOS POR REVISAR</p>
          <strong>
            {inventory.data
              ? inventory.data.products.filter((p) => p.stock <= p.minimum_stock && p.active).length
              : '—'}
          </strong>
          <small className="muted">En su mínimo o agotados</small>
        </div>
        <span className="stat-icon">
          <Package size={20} />
        </span>
      </div>
    </>
  );
}
export default function HomePage() {
  const { profile, bootstrap } = useAuth();
  const today = bootstrap?.server_date ?? bogotaDate();
  const appointments = useTypedQuery('appointments', {
    from: `${today}T00:00:00-05:00`,
    to: `${today}T23:59:59-05:00`,
  });
  const visits = useTypedQuery('visits', { status: 'in_progress', limit: 5, offset: 0 });
  const day = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Bogota',
  }).format(new Date(`${today}T12:00:00-05:00`));
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">{day.toLocaleUpperCase('es-CO')}</p>
          <h1>Hola, {profile?.display_name.split(' ')[0]}.</h1>
          <p>Un nuevo día para hacer sentir bien.</p>
        </div>
        <Link className="button" to="/clientas">
          <Plus size={18} />
          Nueva atención
        </Link>
      </div>
      <div className="card welcome-banner">
        <div>
          <p className="eyebrow">TODO LISTO PARA TU DÍA</p>
          <h2>Más tiempo para lo que amas.</h2>
          <p>Cada cita, cada fórmula y cada detalle de tus clientas, juntos en un mismo lugar.</p>
        </div>
        <Flower2 size={120} strokeWidth={0.7} />
      </div>
      <div className="stats-grid">
        <div className="stat-card card">
          <div>
            <p>CITAS DE HOY</p>
            <strong>{appointments.data?.items.length ?? '—'}</strong>
            <small className="muted">
              {profile?.role === 'owner' ? 'En el salón' : 'En tu agenda'}
            </small>
          </div>
          <span className="stat-icon">
            <CalendarDays size={20} />
          </span>
        </div>
        {profile?.role === 'owner' ? (
          <OwnerStats />
        ) : (
          <div className="stat-card card">
            <div>
              <p>TUS VISITAS EN CURSO</p>
              <strong>{visits.data?.total ?? '—'}</strong>
              <small className="muted">Continúa donde quedaste</small>
            </div>
            <span className="stat-icon">
              <Scissors size={20} />
            </span>
          </div>
        )}
      </div>
      <div className="dashboard-grid">
        <section className="stack">
          <div className="card">
            <div className="section-title">
              <h2>Tu agenda de hoy</h2>
              <Link className="text-link small" to="/agenda">
                Ver agenda
              </Link>
            </div>
            {appointments.isPending ? (
              <Loading />
            ) : appointments.error ? (
              <ErrorState error={appointments.error} />
            ) : !appointments.data?.items.length ? (
              <Empty title="Un día por organizar">
                <p>
                  Las citas de hoy aparecerán aquí. También puedes recibir clientas sin cita previa.
                </p>
              </Empty>
            ) : (
              appointments.data.items.map((a) => (
                <Link className="appointment-row" key={a.id} to="/agenda">
                  <time className="appointment-time">
                    {new Intl.DateTimeFormat('es-CO', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'America/Bogota',
                    }).format(new Date(a.starts_at))}
                  </time>
                  <div className="appointment-info">
                    <strong>{a.client_name}</strong>
                    <p>
                      {bootstrap?.profiles.find((p) => p.id === a.professional_id)?.display_name}
                    </p>
                  </div>
                  <span className="badge">{statusLabel[a.status]}</span>
                  <ArrowRight size={16} className="muted" />
                </Link>
              ))
            )}
          </div>
          <div className="card">
            <div className="section-title">
              <h2>Atenciones en curso</h2>
              <Clock3 size={19} className="muted" />
            </div>
            {visits.data?.items.length ? (
              visits.data.items.map((v) => (
                <Link className="appointment-row" to={`/visitas/${v.id}`} key={v.id}>
                  <div className="client-initial">{v.client_name.slice(0, 1)}</div>
                  <div className="appointment-info">
                    <strong>{v.client_name}</strong>
                    <p>Continuar ficha y cuenta</p>
                  </div>
                  <ArrowRight size={17} />
                </Link>
              ))
            ) : (
              <p className="muted small">No tienes atenciones abiertas.</p>
            )}
          </div>
        </section>
        <aside className="stack">
          <div className="card stack">
            <h2>¿Qué hacemos hoy?</h2>
            <Link className="quick-action" to="/clientas">
              <UsersRound size={22} />
              <span>
                Atender a una clienta<small>Abrir su historia o registrarla</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link className="quick-action" to="/agenda">
              <CalendarDays size={22} />
              <span>
                Organizar la agenda<small>Citas y cumpleaños</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link className="quick-action" to="/servicios">
              <Scissors size={22} />
              <span>
                Servicios y precios<small>El catálogo de tu salón</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          </div>
          <BirthdayNotice />
          {profile?.role === 'owner' && (
            <div className="card">
              <h3>Respaldo de tu información</h3>
              <p className="small muted">
                {bootstrap?.backup?.status === 'success'
                  ? 'Última copia registrada: ' + bootstrap.backup.completed_at
                  : 'Aún no hay una copia completa verificada.'}
              </p>
              <Link to="/ajustes" className="text-link small">
                Revisar respaldo
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
