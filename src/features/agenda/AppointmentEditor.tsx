import EditorForm from '../../components/EditorForm';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Appointment } from '../../lib/contracts';
import { useAuth } from '../../lib/auth';
import { useTypedQuery } from '../../lib/api';
import { useOperation } from '../../lib/useOperation';
import { localDateTime, toIso, statusLabel } from '../../lib/format';
import { ActionButton } from '../../components/ActionButton';

/** Statuses this form may set. En atención/Finalizada come only from the visit workflow. */
const EDITABLE_STATUSES: readonly Appointment['status'][] = [
  'scheduled',
  'confirmed',
  'cancelled',
  'no_show',
];
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const schema = z
  .object({
    client_id: z.string().min(1, 'Selecciona una clienta.'),
    professional_id: z.string().min(1, 'Selecciona la profesional.'),
    starts_at: z.string().regex(DATE_TIME, 'Indica la fecha y hora de inicio.'),
    ends_at: z.string().regex(DATE_TIME, 'Indica la fecha y hora final.'),
    notes: z.string().max(5000, 'Las notas admiten hasta 5000 caracteres.'),
    status: z.enum(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']),
    service_ids: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    if (!DATE_TIME.test(values.starts_at) || !DATE_TIME.test(values.ends_at)) return;
    const start = new Date(toIso(values.starts_at)).getTime();
    const end = new Date(toIso(values.ends_at)).getTime();
    if (end <= start)
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'La hora final debe ser posterior al inicio.',
      });
    else if (end - start > 24 * 60 * 60 * 1000)
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'Una cita puede durar como máximo 24 horas.',
      });
  });
type Values = z.infer<typeof schema>;

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
  const deferredSearch = useDeferredValue(search);
  const clients = useTypedQuery('clients', { search: deferredSearch, limit: 30 });
  const catalog = useTypedQuery('catalog');
  // The chosen client must stay selectable while a new search replaces the option list.
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(() =>
    appointment ? { id: appointment.client_id, name: appointment.client_name } : null,
  );
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
    formState: { isDirty, errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  // A legacy in-progress/completed status stays visible (and unchanged) instead of being lost.
  const statuses = EDITABLE_STATUSES.includes(defaults.status)
    ? EDITABLE_STATUSES
    : [defaults.status, ...EDITABLE_STATUSES];
  const submit = handleSubmit(async (v) => {
    const r = await operation.run('appointment.save', {
      ...v,
      starts_at: toIso(v.starts_at),
      ends_at: toIso(v.ends_at),
      ...(appointment ? { id: appointment.id, version: appointment.version } : {}),
    });
    if (r !== undefined) onClose();
  });
  const clientField = register('client_id', {
    onChange: (event: { target: HTMLSelectElement }) => {
      const option = event.target.selectedOptions[0];
      setPicked(event.target.value ? { id: event.target.value, name: option?.text ?? '' } : null);
    },
  });
  const results = clients.data?.items ?? [];
  // One keyed list: the chosen <option> element is reused, so the browser keeps it selected.
  const clientOptions =
    picked && !results.some((c) => c.id === picked.id) ? [picked, ...results] : results;
  return (
    <EditorForm
      busy={operation.pending}
      dirty={isDirty}
      onChangeCapture={operation.clear}
      className="stack"
      noValidate
      onSubmit={(e) => void submit(e)}
    >
      <div className="section-title">
        <h2>{appointment ? 'Detalle de cita' : 'Nueva cita'}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Cerrar cita"
          data-editor-close
          onClick={onClose}
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
        <select
          aria-invalid={Boolean(errors.client_id)}
          aria-describedby={errors.client_id ? 'appointment-client-error' : undefined}
          {...clientField}
        >
          <option value="">Selecciona una clienta</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.client_id ? (
          <span className="error" id="appointment-client-error">
            {errors.client_id.message}
          </span>
        ) : null}
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
        {errors.professional_id ? (
          <span className="error">{errors.professional_id.message}</span>
        ) : null}
      </label>
      <div className="form-grid">
        <label className="field">
          Inicio
          <input
            type="datetime-local"
            aria-invalid={Boolean(errors.starts_at)}
            {...register('starts_at')}
          />
          {errors.starts_at ? <span className="error">{errors.starts_at.message}</span> : null}
        </label>
        <label className="field">
          Final
          <input
            type="datetime-local"
            aria-invalid={Boolean(errors.ends_at)}
            aria-describedby={errors.ends_at ? 'appointment-end-error' : undefined}
            {...register('ends_at')}
          />
          {errors.ends_at ? (
            <span className="error" id="appointment-end-error">
              {errors.ends_at.message}
            </span>
          ) : null}
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
                { shouldDirty: true, shouldValidate: Boolean(errors.ends_at) },
              );
          }}
        >
          Estimar duración de los servicios
        </button>
      </fieldset>
      <label className="field">
        Estado
        <select {...register('status')} disabled={Boolean(appointment?.visit_id)}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
        {appointment?.visit_id ? (
          <span className="small muted">El estado se actualiza desde la visita.</span>
        ) : (
          <span className="small muted">
            «En atención» y «Finalizada» se asignan al iniciar y cerrar la visita.
          </span>
        )}
      </label>
      <label className="field">
        Notas
        <textarea {...register('notes')} />
        {errors.notes ? <span className="error">{errors.notes.message}</span> : null}
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
            onSuccess={(r) => void navigate(`/visitas/${String(r.visit_id)}`)}
            className="button-secondary"
          >
            {appointment.visit_id ? 'Abrir visita' : 'Iniciar atención'}
          </ActionButton>
        )}
      </div>
      <p className="small muted">No se envían recordatorios de citas.</p>
    </EditorForm>
  );
}
