import { lazy, Suspense, useEffect, useState } from 'react';
import type { SaleLine, VisitService } from '../../lib/contracts';
import { useAuth } from '../../lib/auth';
import { money } from '../../lib/format';
import { validateTechnicalCompletion } from '../technical/types';
import { Loading, Saved } from '../../components/Feedback';
import { ActionButton } from '../../components/ActionButton';
import { useTechnicalDraft } from './useTechnicalDraft';
const TechnicalForm = lazy(() => import('../technical/TechnicalForm'));
export default function ServiceEditor({
  service,
  sales,
  onDirty,
}: {
  service: VisitService;
  sales: SaleLine[];
  onDirty: (dirty: boolean) => void;
}) {
  const { profile } = useAuth();
  const state = useTechnicalDraft(service);
  const [completionErrors, setCompletionErrors] = useState<string[]>([]);
  const [correction, setCorrection] = useState(false);
  const [reason, setReason] = useState('');
  const [mapPending, setMapPending] = useState(false);
  const unsaved = state.dirty || mapPending;
  const completed = service.status === 'completed';
  const canEdit = !completed || correction;
  const firstValuation = completed && service.price === null;
  useEffect(() => {
    onDirty(unsaved || state.busy);
  }, [unsaved, state.busy, onDirty]);
  useEffect(() => {
    if (!unsaved && !state.busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const navigation = (e: MouseEvent) => {
      const link = (e.target as Element).closest('a[href]');
      if (
        link &&
        !window.confirm(
          'Hay cambios sin confirmar en esta ficha. ¿Salir y perder lo que no se haya guardado?',
        )
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', guard);
    document.addEventListener('click', navigation, true);
    return () => {
      window.removeEventListener('beforeunload', guard);
      document.removeEventListener('click', navigation, true);
    };
  }, [unsaved, state.busy]);
  const finalize = async () => {
    const errors = validateTechnicalCompletion(state.draft.technical, sales);
    setCompletionErrors(errors);
    if (!errors.length) await state.save(true);
  };
  return (
    <section className="card stack">
      <div className="section-title">
        <div>
          <h2>{service.name}</h2>
          <span className="small muted">
            {service.path}
            {service.group_id ? ' · Parte de una tanda' : ''}
          </span>
        </div>
        <div aria-live="polite">
          {state.busy ? (
            <span className="badge">Guardando…</span>
          ) : unsaved ? (
            <span className="badge badge-warm">Cambios pendientes</span>
          ) : state.saved ? (
            <Saved />
          ) : (
            <span className="badge">{completed ? 'Trabajo finalizado' : 'Borrador guardado'}</span>
          )}
        </div>
      </div>
      {completed && !correction && (
        <div className="notice">
          Trabajo técnico finalizado.
          {profile?.role === 'owner' && (
            <button className="button-secondary" onClick={() => setCorrection(true)}>
              Corregir ficha
            </button>
          )}
        </div>
      )}
      {correction && (
        <label className="field">
          Motivo de la corrección *
          <input required value={reason} onChange={(e) => setReason(e.target.value)} />
          <small>La información anterior se conserva en auditoría.</small>
        </label>
      )}
      {state.invalid ? (
        <div className="error">
          La versión o los datos de esta ficha no son válidos. No se sobrescribirán. Solicita
          revisar el registro.
        </div>
      ) : (
        <Suspense fallback={<Loading />}>
          <TechnicalForm
            key={service.id}
            kind={service.form_type}
            value={state.draft.technical}
            onChange={(technical) => state.setDraft((d) => ({ ...d, technical }))}
            readOnly={!canEdit}
            sales={sales}
            onPendingChange={setMapPending}
          />
        </Suspense>
      )}
      <div className="form-grid">
        <label className="field">
          Precio de esta atención (COP)
          {service.price_mode === 'custom' ? (
            <input
              disabled={!canEdit && !firstValuation}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Por definir"
              value={state.draft.price}
              onChange={(e) => state.setDraft((d) => ({ ...d, price: e.target.value }))}
            />
          ) : (
            <strong>{money(service.price)}</strong>
          )}
          <small>
            {service.price_mode === 'custom'
              ? 'Se define solo para esta atención. Puede quedar pendiente mientras trabajas.'
              : 'Tarifa fija conservada desde el catálogo.'}
          </small>
        </label>
      </div>
      {state.error && (
        <div className="stack">
          <p className="error" role="alert">
            {state.error}
          </p>
          <button
            className="button-secondary"
            onClick={() => {
              if (
                window.confirm(
                  '¿Recargar la versión del servidor? Los cambios locales sin guardar se descartarán.',
                )
              )
                state.reload();
            }}
          >
            Revisar versión del servidor
          </button>
        </div>
      )}
      {completionErrors.length > 0 && (
        <div className="error" role="alert">
          <ul>
            {completionErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        {mapPending && (
          <p className="notice">
            Aplica o cancela los cambios de la zona antes de guardar o finalizar la ficha.
          </p>
        )}
        {(canEdit || firstValuation) && (
          <button
            className="button-secondary"
            disabled={state.busy || state.invalid || mapPending || (correction && !reason.trim())}
            onClick={() => void state.save(false, reason)}
          >
            {state.error ? 'Reintentar guardado' : 'Guardar ficha'}
          </button>
        )}
        {!completed && (
          <button
            className="button"
            disabled={state.busy || state.invalid || mapPending}
            onClick={() => void finalize()}
          >
            Finalizar trabajo técnico
          </button>
        )}
        {!completed && (
          <ActionButton
            action="service.refresh_price"
            payload={{ id: service.id, version: state.version }}
            disabled={unsaved || state.busy}
            className="button-secondary"
            confirm="¿Actualizar expresamente esta atención con la tarifa vigente del catálogo?"
          >
            Actualizar tarifa
          </ActionButton>
        )}
        {!completed && (
          <ActionButton
            action="service.remove"
            payload={{ id: service.id, version: state.version }}
            disabled={unsaved || state.busy}
            className="button-danger"
            confirm="¿Quitar este servicio en borrador y su ficha? Esta acción conserva la trazabilidad."
          >
            Quitar servicio
          </ActionButton>
        )}
      </div>
    </section>
  );
}
