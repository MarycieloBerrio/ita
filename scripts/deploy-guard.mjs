// Runs before `npm run deploy` builds. Refuses to publish anything that is not exactly the
// reviewed origin/main commit, built for production. See docs/release.md.
// Read-only: `git fetch` updates remote-tracking refs; nothing is committed, pushed or deployed.
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';

const PROJECT_URL = 'https://mrnzvgivfjivuobpgens.supabase.co';
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const problems = [];
try {
  if (git('status', '--porcelain', '--untracked-files=normal'))
    problems.push('El árbol de trabajo tiene cambios o archivos sin versionar (git status).');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') problems.push(`HEAD está en "${branch}", no en main.`);
  // Only contact origin when the local state could be publishable at all.
  if (!problems.length) {
    git('fetch', '--quiet', '--tags', 'origin', 'main');
    const head = git('rev-parse', 'HEAD');
    const remote = git('rev-parse', 'origin/main');
    if (head !== remote)
      problems.push(
        `HEAD (${head.slice(0, 12)}) no es igual a origin/main (${remote.slice(0, 12)}).`,
      );
    const tags = git('tag', '--points-at', 'HEAD')
      .split('\n')
      .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
    if (!tags.length)
      problems.push('HEAD no tiene una etiqueta de versión vX.Y.Z (ver docs/release.md).');
  }
} catch {
  problems.push('No se pudo consultar git/origin. Verificar conexión y que origin exista.');
}

// Same resolution Vite uses for `vite build` (mode production): shell env wins over .env files.
const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
if (env.VITE_APP_ENV !== 'production')
  problems.push(
    `VITE_APP_ENV=${env.VITE_APP_ENV ?? '(sin definir)'}; se requiere VITE_APP_ENV=production (p. ej. en .env.production.local).`,
  );
if (env.VITE_SUPABASE_URL !== PROJECT_URL)
  problems.push('VITE_SUPABASE_URL no apunta al proyecto Supabase autorizado.');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!key.startsWith('sb_publishable_') || key === 'sb_publishable_test')
  problems.push('VITE_SUPABASE_PUBLISHABLE_KEY debe ser la clave publishable real del proyecto.');

if (problems.length) {
  console.error(`DEPLOY_BLOCKED:\n- ${problems.join('\n- ')}\nVer docs/release.md.`);
  process.exit(1);
}
console.log('DEPLOY_GUARD_OK: main == origin/main, etiquetado, árbol limpio, entorno production.');
