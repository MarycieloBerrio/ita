import { NavLink, Outlet } from 'react-router-dom';
import {
  Home,
  UsersRound,
  CalendarDays,
  Scissors,
  Package,
  ChartNoAxesCombined,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  Menu,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { PendingOperationsBanner } from './PendingOperationsBanner';
const navigation = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/clientas', label: 'Clientas', icon: UsersRound },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/servicios', label: 'Servicios y precios', icon: Scissors },
  { to: '/inventario', label: 'Inventario', icon: Package },
  { to: '/finanzas', label: 'Finanzas', icon: ChartNoAxesCombined },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
];
export default function Layout() {
  const { profile, signOut, online, error, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <NavLink to="/" className="wordmark">
          ita<span>ESTUDIO DE BELLEZA</span>
        </NavLink>
        <p className="nav-caption">TU SALÓN</p>
        <nav aria-label="Navegación principal">
          {navigation
            .filter((n) => n.to !== '/finanzas' || profile?.role === 'owner')
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                <Icon size={20} strokeWidth={1.6} />
                <span>{label}</span>
              </NavLink>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">{profile?.display_name.slice(0, 1)}</div>
          <div>
            <NavLink to="/cuenta" title="Gestionar mi contraseña" onClick={() => setOpen(false)}>
              <strong>{profile?.display_name}</strong>
            </NavLink>
            <small>{profile?.role === 'owner' ? 'Dueña' : 'Profesional'}</small>
          </div>
          <button
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="icon-button"
            onClick={() => void signOut()}
          >
            <LogOut size={19} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menú"
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </button>
          <span>Tu salón, en armonía.</span>
          <div className="topbar-right">
            {import.meta.env.VITE_APP_ENV !== 'production' && (
              <span className="pilot-badge">PILOTO · DATOS DE PRUEBA</span>
            )}
            <span className="connection">
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              <span>{online ? 'En línea' : 'Sin conexión'}</span>
            </span>
          </div>
        </header>
        {!online && (
          <div role="alert" className="offline-banner">
            Sin conexión. Los cambios sin guardar permanecen solo en esta pestaña. Las
            confirmaciones están bloqueadas.
          </div>
        )}
        <main id="main" className="main-content">
          {error && (
            <div className="notice" role="alert">
              <p>No se pudo volver a comprobar el acceso. Conservamos los cambios abiertos.</p>
              <button
                className="button-secondary"
                disabled={!online}
                onClick={() => void refresh()}
              >
                Comprobar acceso
              </button>
            </div>
          )}
          <PendingOperationsBanner key={profile?.id} online={online} />
          <Outlet />
        </main>
        <footer className="app-footer">
          ita <span>Hecho con cuidado · America/Bogota</span>
        </footer>
      </div>
    </div>
  );
}
