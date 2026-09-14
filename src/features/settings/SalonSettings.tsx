import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Settings } from '../../lib/contracts';
import { OperationFeedback, useOperation } from '../catalog/operations';

const schema = z.object({
  responsible_name: z.string().trim().max(150),
  responsible_contact: z.string().trim().max(200),
  privacy_text: z.string().max(15000),
  prevent_overlap: z.boolean(),
});
type Values = z.infer<typeof schema>;

export default function SalonSettings({ settings }: { settings: Settings }) {
  const operation = useOperation();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: settings });
  async function save(values: Values) {
    const result = await operation.run(
      'settings.save',
      { ...values, prevent_overlap: true, version: settings.version },
      'Configuración guardada',
    );
    if (result !== undefined) form.reset(values);
  }
  return (
    <form className="card stack" onSubmit={(event) => void form.handleSubmit(save)(event)}>
      <h2>Salón y datos personales</h2>
      <div className="form-grid">
        <label className="field">
          Responsable del tratamiento de datos
          <input {...form.register('responsible_name')} placeholder="Nombre de la responsable" />
        </label>
        <label className="field">
          Contacto para consultas y correcciones
          <input {...form.register('responsible_contact')} placeholder="Contacto del salón" />
        </label>
      </div>
      <label className="field">
        Texto de finalidad y autorización
        <textarea
          rows={10}
          {...form.register('privacy_text')}
          placeholder="Revisar y completar antes de registrar datos reales."
        />
      </label>
      <p className="muted">
        Texto para revisión antes de operar con datos reales: identifica la responsable, finalidad,
        datos opcionales y el procedimiento de consulta, corrección y supresión. El cumpleaños es
        opcional. Guardar este texto no certifica su adecuación legal.
      </p>
      <h3>Disponibilidad en agenda</h3>
      <p className="badge">Se impiden citas solapadas de una misma profesional.</p>
      <p className="muted">
        Regla confirmada. Dos profesionales distintas pueden atender a la misma hora. Una cita que
        empieza cuando termina la anterior es válida.
      </p>
      <OperationFeedback error={operation.error} success={operation.success} />
      <div className="actions">
        <button className="button" disabled={operation.pending}>
          {operation.pending ? 'Guardando…' : 'Guardar configuración'}
        </button>
        {form.formState.isDirty ? <span className="badge">Cambios pendientes</span> : null}
      </div>
    </form>
  );
}
