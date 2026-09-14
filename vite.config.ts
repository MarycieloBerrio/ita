import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !key.startsWith('sb_publishable_')) {
    let anonymous = false;
    try {
      anonymous =
        JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role === 'anon';
    } catch {
      /* Invalid keys fail closed. */
    }
    if (!anonymous)
      throw new Error(
        'Usa únicamente una clave publishable o anon en VITE_SUPABASE_PUBLISHABLE_KEY.',
      );
  }
  return {
    plugins: [react(), tailwindcss()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      exclude: ['node_modules/**', 'e2e/**', 'dist/**'],
    },
    build: { target: 'es2020' },
  };
});
