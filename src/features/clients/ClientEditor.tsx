import EditorForm from '../../components/EditorForm';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Client } from '../../lib/contracts';
import { useOperation } from '../../lib/useOperation';
import { useAllowNavigation } from '../../lib/useUnsavedChanges';
import { useTypedQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDeferredValue } from 'react';
// Keep this marker in sync with the notice and the client-consent migration.
const CLIENT_NOTICE_VERSION = 'client-notice-v1';
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
    consent_confirmed: z.boolean().refine(Boolean, 'Confirma la autorización antes de guardar.'),
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
  const { profile, bootstrap } = useAuth();
  const responsible = bootstrap?.settings.responsible_name.trim() ?? '';
  const contact = bootstrap?.settings.responsible_contact.trim() ?? '';
  const noticeReady = Boolean(responsible && contact);
  const operation = useOperation();
  const allowNavigation = useAllowNavigation();
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
      consent_confirmed: Boolean(client),
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
    const { consent_confirmed, ...clientValues } = parsed;
    const result = await operation.run('client.save', {
      ...clientValues,
      ...(client ? { id: client.id, version: client.version } : {}),
      phone: parsed.phone || null,
      consent: client?.consent ?? (consent_confirmed ? CLIENT_NOTICE_VERSION : ''),
    });
    if (result?.id) {
      // Saved: the host may navigate before the form has reported itself clean.
      allowNavigation();
      onSaved(String(result.id));
    }
  });
  return (
    <EditorForm
      busy={operation.pending}
      dirty={isDirty}
      onChangeCapture={operation.clear}
      onSubmit={(e) => void submit(e)}
      className="stack"
    >
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
      {!client ? (
        <section
          className="notice stack client-consent-notice"
          aria-labelledby="client-privacy-title"
        >
          <h3 id="client-privacy-title">Autorización de tratamiento de datos personales</h3>
          {noticeReady ? (
            <>
              <p>
                <strong>Responsable:</strong> {responsible}. <strong>Contacto:</strong> {contact}.
              </p>
              <p>
                Se registran nombre y, si la clienta los facilita, teléfono y cumpleaños. También se
                conservan citas, servicios, productos, pagos y observaciones necesarias para su
                atención. Se usan para programar y prestar servicios, mantener el historial de
                atención, gestionar cobros y cumplir obligaciones aplicables. El cumpleaños es
                opcional. Estos datos no se usarán para publicidad sin una autorización separada.
              </p>
              <p>
                La clienta puede conocer, actualizar o rectificar sus datos, solicitar su supresión,
                revocar la autorización cuando proceda y pedir constancia de ella. Puede dirigir sus
                solicitudes y pedir una copia de este aviso al contacto indicado. No está obligada a
                responder preguntas sobre datos sensibles o de menores de edad; si fueran
                necesarios, se explicará su finalidad y se solicitará una autorización específica.
              </p>
              <p className="muted">
                Explica el aviso antes de registrar los datos. La autorización debe ser expresa; el
                silencio no equivale a aceptación.
              </p>
              <label className="checkbox-line client-consent-confirmation">
                <input type="checkbox" {...register('consent_confirmed')} />
                <span>
                  Confirmo que informé este aviso y recibí autorización expresa de la clienta antes
                  de guardar sus datos. La clienta puede consultar la{' '}
                  <a href="/privacidad" target="_blank" rel="noopener noreferrer">
                    política de tratamiento de datos personales
                  </a>
                  .
                </span>
              </label>
              <small className="muted">
                Esta casilla deja constancia de quien registra; no reemplaza la respuesta de la
                clienta.
              </small>
              {errors.consent_confirmed && (
                <small className="field-error" role="alert">
                  {String(errors.consent_confirmed.message)}
                </small>
              )}
            </>
          ) : (
            <p className="error" role="alert">
              Completa el nombre y el contacto de la responsable en Ajustes antes de registrar
              clientas.
            </p>
          )}
        </section>
      ) : (
        <p className="muted">Constancia de autorización: {client.consent || 'Sin registrar.'}</p>
      )}
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
        <button
          type="submit"
          className="button"
          disabled={operation.pending || (!client && !noticeReady)}
        >
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
    </EditorForm>
  );
}
