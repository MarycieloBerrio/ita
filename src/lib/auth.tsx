import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile, QueryResults } from './contracts';
import { ApiError, query, queryClient } from './api';
import { supabase, requireSupabase } from './supabase';
import { hasUnsettledOperations, setOperationActor } from './pendingOperations';

function invalidSession(cause: unknown) {
  if (!cause || typeof cause !== 'object') return false;
  const failure = cause as { name?: string; code?: string; status?: number };
  return (
    failure.name === 'AuthSessionMissingError' ||
    failure.status === 401 ||
    failure.status === 403 ||
    [
      'bad_jwt',
      'session_not_found',
      'refresh_token_not_found',
      'refresh_token_already_used',
      'user_not_found',
      'user_banned',
    ].includes(failure.code ?? '') ||
    (cause instanceof ApiError &&
      ['42501', '28000', 'PGRST301', 'PGRST302', 'PGRST303'].includes(cause.code ?? ''))
  );
}

interface AuthState {
  profile: Profile | null;
  bootstrap: QueryResults['bootstrap'] | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  online: boolean;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<QueryResults['bootstrap'] | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const generation = useRef(0);
  const identity = useRef('');
  const clearAccess = useCallback(() => {
    identity.current = '';
    setOperationActor(null);
    setBootstrap(null);
    void queryClient.cancelQueries();
    queryClient.clear();
  }, []);
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const attempt = ++generation.current;
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (attempt !== generation.current) return;
      if (authError) throw authError;
      if (!data.user) {
        clearAccess();
        return;
      }
      // A different verified user must never inherit the previous user's screen or journal.
      if (identity.current && !identity.current.startsWith(`${data.user.id}:`)) clearAccess();
      const next = await query<QueryResults['bootstrap']>('bootstrap');
      if (attempt !== generation.current) return;
      if (!next.profile.active || next.profile.id !== data.user.id) {
        clearAccess();
        setError('Acceso no autorizado o cuenta inactiva.');
        return;
      }
      const nextIdentity = `${next.profile.id}:${next.profile.role}`;
      if (identity.current && identity.current !== nextIdentity) queryClient.clear();
      identity.current = nextIdentity;
      setOperationActor(next.profile.id);
      setBootstrap(next);
      setError('');
    } catch (e) {
      if (attempt !== generation.current) return;
      const noSession = e instanceof Error && e.name === 'AuthSessionMissingError';
      setError(noSession ? '' : e instanceof Error ? e.message : 'No se pudo comprobar el acceso.');
      // A transport failure is not evidence of logout. Keep mounted editors and their drafts.
      if (invalidSession(e)) clearAccess();
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }, [clearAccess]);
  useEffect(() => {
    const initialization = setTimeout(() => void refresh(), 0);
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        generation.current++;
        clearAccess();
      } else if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'PASSWORD_RECOVERY'
      ) {
        if (
          identity.current &&
          session?.user &&
          !identity.current.startsWith(`${session.user.id}:`)
        ) {
          generation.current++;
          clearAccess();
        }
        setTimeout(() => void refresh(), 0);
      }
    });
    const focus = () => {
      void queryClient.cancelQueries();
      void queryClient.invalidateQueries({
        predicate: (q) =>
          ['appointments', 'visit', 'visits', 'finance'].includes(String(q.queryKey[0])),
      });
      void refresh();
    };
    const network = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsettledOperations()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      clearTimeout(initialization);
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [refresh, clearAccess]);
  const signOut = async () => {
    generation.current++;
    await queryClient.cancelQueries();
    const { error: failure } = await requireSupabase().auth.signOut({ scope: 'local' });
    if (failure) {
      setError('No se pudo cerrar la sesión. Vuelve a intentar.');
      return;
    }
    clearAccess();
  };
  return (
    <AuthContext.Provider
      value={{
        profile: bootstrap?.profile ?? null,
        bootstrap,
        loading,
        error,
        refresh,
        signOut,
        online,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider requerido');
  return context;
}
