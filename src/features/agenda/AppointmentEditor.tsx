import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Appointment } from '../../lib/contracts';
import { useAuth } from '../../lib/auth';
import { useTypedQuery } from '../../lib/api';
import { useOperation } from '../../lib/useOperation';
import { localDateTime, toIso, statusLabel } from '../../lib/format';
import { ActionButton } from '../../components/ActionButton';
interface Values {
  client_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  notes: string;
  status: Appointment['status'];
  service_ids: string[];
}
export default function AppointmentEditor({
  appointment,
  start,
  onClose,
}: {
  appointment?: Appointment;
  start?: string;
  onClose: () => void;
}) {
  const { profile, bootstrap } = useAuth();
  const navigate = useNavigate();
  const operation = useOperation();
  const [search, setSearch] = useState('');
  const clients = useTypedQuery('clients', { search, limit: 30 });
  const catalog = useTypedQuery('catalog');
  const [defaults] = useState<Values>(() => {
    const initialStart = appointment
      ? localDateTime(new Date(appointment.starts_at))
      : (start ?? localDateTime());
    return {
      client_id: appointment?.client_id ?? '',
      professional_id: appointment?.professional_id ?? profile?.id ?? '',
      starts_at: initialStart,
      ends_at: appointment
        ? localDateTime(new Date(appointment.ends_at))
        : localDateTime(new Date(new Date(toIso(initialStart)).getTime() + 60 * 60 * 1000)),
      notes: appointment?.notes ?? '',
      status: appointment?.status ?? 'scheduled',
      service_ids: appointment?.service_ids ?? [],
    };
  });
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { isDirty },
  } = useForm<Values>({
    defaultValues: defaults,
  });
  const submit = handleSubmit(async (v) => {
    if (new Date(toIso(v.ends_at)) <= new Date(toIso(v.starts_at))) {
      window.alert('La hora final debe ser posterior al inicio.');
      return;
    }
    const r = await operation.run('appointment.save', {
      ...v,
      starts_at: toIso(v.starts_at),
      ends_at: toIso(v.ends_at),
      ...(appointment ? { id: appointment.id, version: appointment.version } : {}),
    });
    if (r) onClose();
  });
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="section-title">
        <h2>{appointment ? 'Detalle de cita' : 'Nueva cita'}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Cerrar cita"
          onClick={() => {
            if (!isDirty || confirm('Hay cambios sin guardar. ¿Cerrar?')) onClose();
          }}
        >
          ×
        </button>
      </div>
      <label className="field">
        Buscar clienta
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label className="field">
        Clienta
        <select required {...register('client_id')}>
          <option value="">Selecciona una clienta</option>
          {appointment && !clients.data?.items.some((c) => c.id === appointment.client_id) && (
            <option value={appointment.client_id}>{appointment.client_name}</option>
          )}
          {clients.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Profesional
        <select {...register('professional_id')} disabled={profile?.role === 'worker'}>
          {bootstrap?.profiles
            .filter((p) => p.active && (profile?.role === 'owner' || p.id === profile?.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label className="field">
          Inicio
          <input type="datetime-local" required {...register('starts_at')} />
        </label>
        <label className="field">
          Final
          <input type="datetime-local" required {...register('ends_at')} />
        </label>
      </div>
      <fieldset className="stack">
        <legend>Servicios previstos</legend>
        <div className="service-select-list">
          {catalog.data?.services
            .filter((s) => s.active)
            .map((s) => (
              <label className="service-choice" key={s.id}>
                <input type="checkbox" value={s.id} {...register('service_ids')} />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.path} · {s.duration_minutes} min
                  </small>
                </span>
              </label>
            ))}
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            const minutes =
              catalog.data?.services
                .filter((s) => getValues('service_ids').includes(s.id))
                .reduce((sum, s) => sum + s.duration_minutes, 0) ?? 0;
            if (minutes)
              setValue(
                'ends_at',
                localDateTime(
                  new Date(new Date(toIso(getValues('starts_at'))).getTime() + minutes * 60000),
                ),
                { shouldDirty: true },
              );
          }}
        >
          Estimar duración de los servicios
        </button>
      </fieldset>
      <label className="field">
        Estado
        <select {...register('status')} disabled={Boolean(appointment?.visit_id)}>
          {['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map(
            (s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ),
          )}
        </select>
        {appointment?.visit_id && (
          <span className="small muted">El estado se actualiza desde la visita.</span>
        )}
      </label>
      <label className="field">
        Notas
        <textarea {...register('notes')} />
      </label>
      {operation.error && (
        <p role="alert" className="error">
          {operation.error}
        </p>
      )}
      <div className="actions">
        <button className="button" disabled={operation.pending}>
          {operation.pending ? 'Guardando…' : 'Guardar cita'}
        </button>
        {appointment && !['cancelled', 'no_show'].includes(appointment.status) && (
          <ActionButton
            action="appointment.start"
            payload={{ id: appointment.id, version: appointment.version }}
            disabled={isDirty}
            onSuccess={(r) => navigate(`/visitas/${String(r.visit_id)}`)}
            className="button-secondary"
          >
            {appointment.visit_id ? 'Abrir visita' : 'Iniciar atención'}
          </ActionButton>
        )}
      </div>
      <p className="small muted">No se envían recordatorios de citas.</p>
    </form>
  );
}
