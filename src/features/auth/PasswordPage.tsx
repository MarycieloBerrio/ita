import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

const schema = z
  .object({
    password: z
      .string()
      .min(12, 'Usa al menos 12 caracteres.')
      .max(128, 'Usa hasta 128 caracteres.'),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmation'],
  });

export default function PasswordPage() {
  const { profile, online, signOut } = useAuth();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async ({ password }) => {
    setError('');
    setSaved(false);
    if (!online) {
      setError('Necesitas conexión para cambiar tu contraseña.');
      return;
    }
    try {
      const result = await requireSupabase().auth.updateUser({ password });
      if (result.error) throw result.error;
      reset();
      setSaved(true);
    } catch {
      setError(
        'No se confirmó el cambio. Revisa la conexión y prueba una contraseña diferente. Si tu sesión ha vencido, solicita recuperar el acceso.',
      );
    }
  });
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">TU ACCESO PERSONAL</p>
          <h1>Tu contraseña</h1>
          <p>{profile?.display_name}</p>
        </div>
      </header>
      <section className="card stack" style={{ maxWidth: 640 }}>
        <p>
          Elige una contraseña que solo tú conozcas. Puedes usar una frase larga y fácil de
          recordar.
        </p>
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <label className="field">
            Nueva contraseña
            <input type="password" autoComplete="new-password" {...register('password')} />
            {errors.password && <small className="field-error">{errors.password.message}</small>}
          </label>
          <label className="field">
            Repetir nueva contraseña
            <input type="password" autoComplete="new-password" {...register('confirmation')} />
            {errors.confirmation && (
              <small className="field-error">{errors.confirmation.message}</small>
            )}
          </label>
          <button className="button" disabled={isSubmitting || !online}>
            {isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {saved && (
          <div role="status" className="notice">
            Contraseña actualizada. Ya puedes ingresar con ella.
            <button className="button-secondary" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
        )}
        <p className="small muted">
          Para recuperar el acceso sin una sesión abierta, contacta a la responsable del salón. El
          soporte verificará tu identidad y te permitirá establecer una nueva contraseña sin pedirte
          la anterior.
        </p>
      </section>
    </div>
  );
}
