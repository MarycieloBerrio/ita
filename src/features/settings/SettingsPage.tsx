import { useEffect, useState } from 'react';
import { ExternalLink, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAppQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { QueryResults } from '../../lib/contracts';
import { bogotaDate, QueryFeedback } from '../catalog/operations';
import ExportButton from '../exports/ExportButton';
import PaymentMethods from './PaymentMethods';
import Profiles from './Profiles';
import SalonSettings from './SalonSettings';
import '../catalog/catalog.css';

function OwnerSettings() {
  const request = useAppQuery<QueryResults['settings']>('settings');
  const [showAudit, setShowAudit] = useState(false);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCheckedAt(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const backup = request.data?.backup;
  const outdated =
    !backup?.completed_at ||
    checkedAt - new Date(backup.completed_at).getTime() > 24 * 60 * 60 * 1000;
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <p className="muted">Tu salón</p>
          <h1>
            <SettingsIcon aria-hidden="true" /> Ajustes
          </h1>
          <p>Acceso, formas de pago y cuidado de la información.</p>
        </div>
      </header>
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      <section className="card">
        <h2>Configuración regional</h2>
        <div className="operation-summary">
          <div>
            <span>País</span>
            <strong>Colombia</strong>
          </div>
          <div>
            <span>Moneda</span>
            <strong>COP</strong>
          </div>
          <div>
            <span>Zona horaria</span>
            <strong style={{ fontSize: '1.1rem' }}>America/Bogota</strong>
          </div>
        </div>
        <p className="muted">
          Operación con conexión a Internet. Fechas de agenda, cobros y cierre corresponden a
          Bogotá.
        </p>
      </section>
      {request.data ? (
        <>
          <PaymentMethods methods={request.data.payment_methods} />
          <SalonSettings key={request.data.settings.version} settings={request.data.settings} />
          <Profiles profiles={request.data.profiles} />
        </>
      ) : null}
      <section className="card stack">
        <h2>
          <ShieldCheck size={22} aria-hidden="true" /> Respaldo y recuperación
        </h2>
        <p className={backup?.status === 'failed' || outdated ? 'error' : 'success'} role="status">
          {!backup
            ? 'No hay una copia completada registrada.'
            : backup.status === 'failed'
              ? `Última ejecución fallida. ${backup.message}`
              : outdated
                ? 'La última copia registrada tiene más de 24 horas. Revisa el proceso.'
                : 'Última copia completada correctamente.'}
        </p>
        {backup?.completed_at ? (
          <p>
            Última copia: <strong>{bogotaDate(backup.completed_at)}</strong>
            {backup.bytes != null
              ? ` · ${(backup.bytes / 1024 / 1024).toFixed(2)} MB cifrados`
              : ''}
          </p>
        ) : null}
        <p className="muted">
          En GitHub, la dueña autorizada puede ejecutar el proceso y descargar el archivo cifrado.
          La clave de recuperación se conserva por separado. Las ejecuciones programadas pueden
          retrasarse; revisa este estado y conserva una copia independiente.
        </p>
        <a
          className="button-secondary"
          href="https://github.com/MarycieloBerrio/ita/actions"
          target="_blank"
          rel="noreferrer"
        >
          Ejecutar o descargar respaldo en GitHub <ExternalLink size={16} aria-hidden="true" />
        </a>
        <p className="muted">
          Antes de usar datos reales debe completarse una restauración verificada y acordarse
          responsable de soporte y destino de copia independiente. El estado de copia no demuestra
          por sí solo que esa restauración se haya probado.
        </p>
      </section>
      <section className="card stack">
        <h2>Exportación integral de registros</h2>
        <p>
          Descarga los datos operativos autorizados en JSON. El archivo contiene información
          personal: guárdalo en un lugar privado. Esta exportación no incluye las cuentas de
          autenticación ni sustituye el respaldo recuperable.
        </p>
        <ExportButton scope="global" />
      </section>
      <section className="card stack">
        <h2>Historial de cambios</h2>
        <p className="muted">
          Consulta quién realizó cada operación y los motivos de las correcciones.
        </p>
        <button className="button-secondary" onClick={() => setShowAudit(!showAudit)}>
          {showAudit ? 'Ocultar auditoría' : 'Consultar auditoría'}
        </button>
        {showAudit ? <AuditLog /> : null}
      </section>
    </div>
  );
}

function AuditLog() {
  const [page, setPage] = useState(0);
  const request = useAppQuery<QueryResults['audit']>('audit', { page, limit: 25 });
  return (
    <div className="stack">
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      {request.data?.items.length === 0 ? (
        <p className="empty">No hay cambios para mostrar.</p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Operación</th>
              <th>Responsable</th>
              <th>Motivo / detalle</th>
            </tr>
          </thead>
          <tbody>
            {request.data?.items.map((item) => (
              <tr key={item.id}>
                <td>{bogotaDate(item.created_at)}</td>
                <td>
                  {item.action}
                  <p>
                    <small>{item.entity_id}</small>
                  </p>
                </td>
                <td>{item.actor_id.slice(0, 8)}</td>
                <td>
                  {item.reason}
                  <details>
                    <summary>Antes y después</summary>
                    <p>Registro anterior</p>
                    <pre>{JSON.stringify(item.before_data, null, 2)}</pre>
                    <p>Registro posterior</p>
                    <pre>{JSON.stringify(item.after_data, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button
          className="button-secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Anterior
        </button>
        <span>Página {page + 1}</span>
        <button
          className="button-secondary"
          disabled={(request.data?.items.length ?? 0) < 25}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { profile } = useAuth();
  return profile?.role === 'owner' ? (
    <OwnerSettings />
  ) : (
    <div className="stack">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>
      <section className="card stack">
        <h2>Tu cuenta</h2>
        <p>{profile?.display_name} · Trabajadora</p>
        <p>
          Gestiona tus citas, fichas y cobros desde tu cuenta personal. Para cambiar nombre o
          recuperar acceso, contacta a la dueña.
        </p>
        <p className="muted">
          Colombia · COP · America/Bogota. La aplicación requiere conexión a Internet.
        </p>
      </section>
    </div>
  );
}
