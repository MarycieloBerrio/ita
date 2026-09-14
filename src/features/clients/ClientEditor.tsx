import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Client } from '../../lib/contracts';
import { useOperation } from '../../lib/useOperation';
import { useTypedQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDeferredValue } from 'react';
const optionalInteger = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(v)),
  z.number().int().nullable(),
);
const clientSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(150),
    phone: z.string().max(40),
    birth_day: optionalInteger,
    birth_month: optionalInteger,
    birth_year: optionalInteger,
    notes: z.string().max(10000),
    consent: z.string().max(2000),
    active: z.boolean(),
  })
  .superRefine((v, c) => {
    if (v.birth_year !== null && (v.birth_day === null || v.birth_month === null))
      c.addIssue({
        code: 'custom',
        message: 'Para registrar el año, completa también día y mes.',
        path: ['birth_day'],
      });
    if ((v.birth_day === null) !== (v.birth_month === null))
      c.addIssue({
        code: 'custom',
        message: 'Completa día y mes, o deja ambos vacíos.',
        path: ['birth_day'],
      });
    if (v.birth_day !== null && v.birth_month !== null) {
      const year = v.birth_year ?? 2000;
      const d = new Date(Date.UTC(year, v.birth_month - 1, v.birth_day));
      if (
        d.getUTCMonth() !== v.birth_month - 1 ||
        d.getUTCDate() !== v.birth_day ||
        year < 1900 ||
        year > new Date().getFullYear()
      )
        c.addIssue({
          code: 'custom',
          message: 'Revisa la fecha de cumpleaños.',
          path: ['birth_day'],
        });
    }
  });
type FormValues = z.input<typeof clientSchema>;
export default function ClientEditor({
  client,
  onSaved,
  onCancel,
}: {
  client?: Client;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const { profile } = useAuth();
  const operation = useOperation();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name ?? '',
      phone: client?.phone ?? '',
      birth_day: client?.birth_day ?? null,
      birth_month: client?.birth_month ?? null,
      birth_year: client?.birth_year ?? null,
      notes: client?.notes ?? '',
      consent: client?.consent ?? '',
      active: client?.active ?? true,
    },
  });
  const name = useWatch({ control, name: 'name' });
  const phone = useWatch({ control, name: 'phone' });
  const searchName = useDeferredValue(name);
  const searchPhone = useDeferredValue(phone);
  const existing = useTypedQuery('clients', { search: searchName, limit: 5, offset: 0 });
  const existingPhone = useTypedQuery('clients', { search: searchPhone, limit: 5, offset: 0 });
  const submit = handleSubmit(async (values) => {
    const parsed = clientSchema.parse(values);
    const result = await operation.run('client.save', {
      ...parsed,
      ...(client ? { id: client.id, version: client.version } : {}),
      phone: parsed.phone || null,
    });
    if (result?.id) onSaved(String(result.id));
  });
  return (
    <form onSubmit={(e) => void submit(e)} className="stack">
      <div className="section-title">
        <h2>{client ? 'Datos de la clienta' : 'Nueva clienta'}</h2>
        <span className="badge">{isDirty ? 'Cambios pendientes' : 'Datos personales'}</span>
      </div>
      <div className="form-grid">
        <label className="field">
          Nombre *<input autoComplete="name" {...register('name')} />
          {errors.name && <small className="field-error">{String(errors.name.message)}</small>}
        </label>
        <label className="field">
          Teléfono (opcional)
          <input type="tel" autoComplete="tel" {...register('phone')} />
        </label>
      </div>
      {!client && name?.length > 2 && existing.data?.items.length ? (
        <div className="notice">
          Hay nombres similares: {existing.data.items.map((c) => c.name).join(', ')}. Puedes
          continuar si se trata de otra clienta.
        </div>
      ) : null}
      {phone.replace(/\D/g, '').length > 5 &&
        existingPhone.data?.items.some((c) => c.id !== client?.id) && (
          <div className="notice">
            Hay clientas con teléfono similar:{' '}
            {existingPhone.data.items
              .filter((c) => c.id !== client?.id)
              .map((c) => c.name)
              .join(', ')}
            . Comprueba si ya está registrada; un teléfono familiar puede compartirse.
          </div>
        )}
      <fieldset>
        <legend>Cumpleaños · opcional</legend>
        <div className="form-grid">
          <label className="field">
            Día
            <input type="number" min="1" max="31" inputMode="numeric" {...register('birth_day')} />
          </label>
          <label className="field">
            Mes
            <select {...register('birth_month')}>
              <option value="">Sin registrar</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Intl.DateTimeFormat('es', { month: 'long' }).format(new Date(2000, i, 1))}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Año (opcional)
            <input
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              placeholder="No es necesario"
              {...register('birth_year')}
            />
          </label>
        </div>
        {errors.birth_day && <p className="field-error">{String(errors.birth_day.message)}</p>}
      </fieldset>
      <label className="field">
        Notas
        <textarea
          {...register('notes')}
          placeholder="Preferencias y observaciones para su atención"
        />
      </label>
      <label className="field">
        Constancia de autorización de datos
        <textarea
          {...register('consent')}
          placeholder="Registra fecha, medio y versión del texto autorizado, cuando proceda."
        />
        <small>
          El cumpleaños es voluntario. Revisa el texto de tratamiento de datos configurado por la
          responsable antes de usar información real.
        </small>
      </label>
      {client && profile?.role === 'owner' && (
        <label className="checkbox-line">
          <input type="checkbox" {...register('active')} />
          Clienta activa
        </label>
      )}
      {operation.error && (
        <p role="alert" className="error">
          {operation.error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={operation.pending}>
          {operation.pending ? 'Guardando…' : 'Guardar clienta'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            if (
              !isDirty ||
              window.confirm('Los cambios pendientes se perderán. ¿Salir del formulario?')
            )
              onCancel();
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
