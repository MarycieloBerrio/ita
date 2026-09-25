import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import Dialog from '../components/Dialog';

interface UnsavedChangesRegistry {
  register: () => () => void;
  allowNextNavigation: () => void;
}
const UnsavedChangesContext = createContext<UnsavedChangesRegistry | null>(null);

/**
 * One router blocker for the whole app. React Router honours a single active blocker, so every
 * form registers its dirty state here instead of calling useBlocker itself.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const active = useRef(0);
  const bypass = useRef(false);
  const register = useCallback(() => {
    active.current += 1;
    setCount(active.current);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      active.current -= 1;
      setCount(active.current);
    };
  }, []);
  const allowNextNavigation = useCallback(() => {
    bypass.current = true;
    // Only the navigation issued in the same task is exempt.
    setTimeout(() => {
      bypass.current = false;
    }, 0);
  }, []);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (bypass.current) {
      bypass.current = false;
      return false;
    }
    return (
      active.current > 0 &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search)
    );
  });
  useEffect(() => {
    if (!count) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [count]);
  useEffect(() => {
    // The form was saved or discarded while the question was open: nothing is at risk anymore.
    if (blocker.state === 'blocked' && count === 0) blocker.proceed();
  }, [blocker, count]);
  const value = useMemo(() => ({ register, allowNextNavigation }), [register, allowNextNavigation]);
  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {blocker.state === 'blocked' && (
        <Dialog title="Cambios sin guardar" onClose={() => blocker.reset()}>
          <div className="stack">
            <h2>Cambios sin guardar</h2>
            <p>
              Hay cambios que todavía no se han confirmado. Si sales ahora, se perderán los que no
              se hayan guardado.
            </p>
            <div className="actions">
              <button type="button" className="button" autoFocus onClick={() => blocker.reset()}>
                Seguir editando
              </button>
              <button type="button" className="button-danger" onClick={() => blocker.proceed()}>
                Salir sin guardar
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </UnsavedChangesContext.Provider>
  );
}

/**
 * Warn before in-app navigation (router blocker with an in-page confirmation) and before
 * closing or reloading the tab while `dirty` is true. Outside the provider it is a no-op.
 */
export function useUnsavedChanges(dirty: boolean) {
  const registry = useContext(UnsavedChangesContext);
  useEffect(() => {
    if (!dirty || !registry) return;
    return registry.register();
  }, [dirty, registry]);
}

/** Let a confirmed save navigate away before its form has had time to report itself clean. */
export function useAllowNavigation() {
  const registry = useContext(UnsavedChangesContext);
  return registry?.allowNextNavigation ?? noop;
}
function noop() {}
