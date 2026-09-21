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
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { PendingOperationsBanner } from './PendingOperationsBanner';
import BrandLogo from './BrandLogo';
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia('(max-width: 1024px)');
    const previousOverflow = document.body.style.overflow;
    if (media.matches) document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (!media.matches) return;
      if (event.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const focusable = sidebar.current?.querySelectorAll<HTMLElement>('a, button:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onMediaChange = () => setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    media.addEventListener('change', onMediaChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      media.removeEventListener('change', onMediaChange);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    menuButton.current?.focus();
  };
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <aside id="main-sidebar" ref={sidebar} className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-header">
          <NavLink to="/" className="wordmark" onClick={() => setOpen(false)}>
            <BrandLogo tone="forest" />
          </NavLink>
          <button
            ref={closeButton}
            className="icon-button sidebar-close"
            aria-label="Cerrar menú"
            onClick={closeMenu}
          >
            <X size={22} />
          </button>
        </div>
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
      {open && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Cerrar menú"
          tabIndex={-1}
          onClick={closeMenu}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            aria-controls="main-sidebar"
            ref={menuButton}
            onClick={() => {
              setOpen(!open);
              if (!open) requestAnimationFrame(() => closeButton.current?.focus());
            }}
          >
            <Menu />
          </button>
          <span>Tu salón, en armonía.</span>
          <div className="topbar-right">
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
          ita <span>Hecho con cuidado</span>
        </footer>
      </div>
    </div>
  );
}
