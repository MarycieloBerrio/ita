import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const isConfigured = Boolean(url && key && !key.startsWith('sb_secret_'));
export const supabase = isConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
export function requireSupabase() {
  if (!supabase)
    throw new Error('Falta configurar la conexión con Supabase. Consulta la guía de instalación.');
  return supabase;
}
