import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Flower2, LockKeyhole } from 'lucide-react';
import { isConfigured, requireSupabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
const schema = z.object({
  email: z.string().email('Escribe un correo válido.'),
  password: z.string().min(1, 'Escribe tu contraseña.'),
});
export default function LoginPage() {
  const { refresh, error: profileError } = useAuth();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const { error: e } = await requireSupabase().auth.signInWithPassword(values);
      if (e) throw new Error('No fue posible ingresar. Revisa tu correo y contraseña.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ingresar.');
    }
  });
  return (
    <main className="login-page">
      <section className="login-story">
        <a className="wordmark" href="/">
          ita<span>ESTUDIO DE BELLEZA</span>
        </a>
        <div>
          <Flower2 size={80} strokeWidth={0.7} />
          <p className="eyebrow">UN ESPACIO PARA CUIDAR</p>
          <h1>
            Cada detalle,
            <br />
            <em>en su lugar.</em>
          </h1>
          <p>
            Tu agenda, tus clientas y la historia
            <br />
            de cada transformación.
          </p>
        </div>
        <span>Hecho para el ritmo de tu salón.</span>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="overline">BIENVENIDA A TU ESPACIO</span>
          <h2>Qué bueno verte.</h2>
          <p className="muted">Ingresa con tu cuenta personal para comenzar.</p>
          {!isConfigured && (
            <div className="notice">
              Conexión pendiente de configurar. Este entorno todavía no puede guardar datos ni
              iniciar sesión.
            </div>
          )}
          <form onSubmit={(e) => void submit(e)} className="stack">
            <label className="field">
              Correo electrónico
              <input type="email" autoComplete="username" {...register('email')} />
              {errors.email && <small className="field-error">{errors.email.message}</small>}
            </label>
            <label className="field">
              Contraseña
              <input type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <small className="field-error">{errors.password.message}</small>}
            </label>
            {(error || profileError) && (
              <p className="error" role="alert">
                {error || profileError}
              </p>
            )}
            <button className="button" disabled={!isConfigured || isSubmitting}>
              {isSubmitting ? 'Comprobando acceso…' : 'Entrar al salón'}
              <ArrowRight size={20} />
            </button>
          </form>
          <p className="small muted">
            Si necesitas recuperar tu acceso, comunícate con la responsable del salón para verificar
            tu identidad.
          </p>
          <div className="login-private">
            <LockKeyhole size={16} /> Acceso privado · Colombia · COP
          </div>
        </div>
      </section>
    </main>
  );
}
