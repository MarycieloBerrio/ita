import { useState } from 'react';
import type { Profile } from '../../lib/contracts';
import { OperationFeedback, useOperation } from '../catalog/operations';

function ProfileRow({ profile }: { profile: Profile }) {
  const operation = useOperation();
  const [name, setName] = useState(profile.display_name);
  const [role, setRole] = useState(profile.role);
  const [active, setActive] = useState(profile.active);
  const dirty = name !== profile.display_name || role !== profile.role || active !== profile.active;
  async function save() {
    if (!name.trim()) {
      operation.setError('Escribe un nombre.');
      return;
    }
    await operation.run(
      'profile.save',
      { id: profile.id, version: profile.version, display_name: name.trim(), role, active },
      'Perfil actualizado',
    );
  }
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
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
    </form>
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
        <ProfileRow key={`${profile.id}-${profile.version}`} profile={profile} />
      ))}
    </section>
  );
}
