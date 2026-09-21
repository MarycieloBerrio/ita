import { useEffect, useState } from 'react';
import EditorForm from '../../components/EditorForm';
import type { Profile } from '../../lib/contracts';
import { OperationFeedback, useOperation } from '../catalog/operations';

function ProfileRow({ profile }: { profile: Profile }) {
  const operation = useOperation();
  const [base, setBase] = useState(profile);
  const [name, setName] = useState(profile.display_name);
  const [role, setRole] = useState(profile.role);
  const [active, setActive] = useState(profile.active);
  const dirty = name !== base.display_name || role !== base.role || active !== base.active;
  useEffect(() => {
    if (dirty || operation.pending || profile.version <= base.version) return;
    const timer = setTimeout(() => {
      setBase(profile);
      setName(profile.display_name);
      setRole(profile.role);
      setActive(profile.active);
    }, 0);
    return () => clearTimeout(timer);
  }, [profile, base.version, dirty, operation.pending]);
  async function save() {
    if (!name.trim()) {
      operation.setError('Escribe un nombre.');
      return;
    }
    const result = await operation.run<Profile>(
      'profile.save',
      { id: profile.id, version: base.version, display_name: name.trim(), role, active },
      'Perfil actualizado',
    );
    if (result) {
      setBase(result);
      setName(result.display_name);
      setRole(result.role);
      setActive(result.active);
    }
  }
  return (
    <EditorForm
      busy={operation.pending}
      dirty={dirty}
      onChangeCapture={operation.clear}
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {dirty && profile.version !== base.version && (
        <div className="error" role="alert">
          Otra sesión cambió este perfil. Conservamos tus cambios para revisarlos.
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setBase(profile);
              setName(profile.display_name);
              setRole(profile.role);
              setActive(profile.active);
              operation.clear();
            }}
          >
            Descartar cambios y cargar perfil vigente
          </button>
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          Nombre visible
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
        </label>
        <label className="field">
          Rol
          <select value={role} onChange={(event) => setRole(event.target.value as Profile['role'])}>
            <option value="owner">Dueña · administración global</option>
            <option value="worker">Trabajadora · atenciones propias</option>
          </select>
        </label>
      </div>
      <label className="actions">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />{' '}
        Cuenta habilitada
      </label>
      <OperationFeedback error={operation.error} success={operation.success} />
      <div className="actions">
        <button className="button-secondary" disabled={!dirty || operation.pending}>
          {operation.pending ? 'Guardando…' : 'Guardar perfil'}
        </button>
        {dirty ? <span className="badge">Cambios de acceso pendientes</span> : null}
      </div>
    </EditorForm>
  );
}

export default function Profiles({ profiles }: { profiles: Profile[] }) {
  return (
    <section className="card stack">
      <h2>Cuentas personales</h2>
      <p className="muted">
        Cada persona utiliza su propia cuenta. La administración de acceso comprueba los permisos en
        el servidor. El alta y recuperación de contraseñas se realizan mediante el procedimiento
        administrativo de Supabase Auth.
      </p>
      {profiles.map((profile) => (
        <ProfileRow key={profile.id} profile={profile} />
      ))}
    </section>
  );
}
