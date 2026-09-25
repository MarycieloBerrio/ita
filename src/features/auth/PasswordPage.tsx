import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { requireSupabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

const schema = z
  .object({
    current: z.string().max(128, 'Usa hasta 128 caracteres.').optional(),
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
  const { profile, online, signOut, recovering, endRecovery } = useAuth();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async ({ current, password }) => {
    setError('');
    setSaved(false);
    if (!online) {
      setError('Necesitas conexión para cambiar tu contraseña.');
      return;
    }
    if (!recovering && !current) {
      setError('Escribe tu contraseña actual para confirmar que eres tú.');
      return;
    }
    const auth = requireSupabase().auth;
    try {
      if (!recovering) {
        // An unlocked, signed-in device must not be enough to take over the account.
        const { data } = await auth.getUser();
        const email = data.user?.email;
        if (!email) throw new Error('missing email');
        const check = await auth.signInWithPassword({ email, password: current ?? '' });
        if (check.error) {
          setError('La contraseña actual no es correcta.');
          return;
        }
      }
      const result = await auth.updateUser({ password });
      if (result.error) throw result.error;
      endRecovery();
      reset();
      setSaved(true);
    } catch {
      setError(
        'No se confirmó el cambio. Revisa la conexión y prueba una contraseña diferente. Si tu sesión ha vencido, solicita recuperar el acceso.',
      );
      return;
    }
    // Other devices signed in with the old password lose their sessions.
    const others = await auth.signOut({ scope: 'others' }).catch(() => ({ error: true }));
    if (others.error)
      setError(
        'La contraseña cambió, pero no se confirmó el cierre de las demás sesiones. Ciérralas manualmente en esos dispositivos.',
      );
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
          {!recovering && (
            <label className="field">
              Contraseña actual
              <input type="password" autoComplete="current-password" {...register('current')} />
              {errors.current && <small className="field-error">{errors.current.message}</small>}
            </label>
          )}
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
