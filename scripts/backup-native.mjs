// Manual linked-project backup. CLI-generated credentials and scripts remain in memory.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { encryptFile } from './backup-crypto.mjs';
import {
  BUNDLE_FILES,
  PROJECT_REF,
  SQL_FILES,
  run,
  sha256,
  temporaryWork,
} from './backup-common.mjs';

const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
export const NATIVE_DUMPS = [
  ['roles.sql', '--role-only'],
  // Including Auth explicitly makes its actual schema available for isolated PostgreSQL recovery.
  ['schema.sql', '--schema', 'auth,public,ita_private'],
  ['data.sql', '--use-copy', '--data-only', '--schema', 'auth,public,ita_private'],
  ['history_schema.sql', '--schema', 'supabase_migrations'],
  ['history_data.sql', '--use-copy', '--data-only', '--schema', 'supabase_migrations'],
];

export function validateNativeDump(script) {
  const names = [...script.matchAll(/^export (PG[A-Z_]+)=/gm)].map((match) => match[1]);
  const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
  if (
    !script.startsWith('#!/usr/bin/env bash\n') ||
    !script.includes('set -euo pipefail') ||
    !/^pg_dump(?:all)?\s/m.test(script) ||
    names.length !== required.length ||
    required.some((name) => !names.includes(name))
  )
    throw new Error('UNEXPECTED_CLI_DUMP_SCRIPT');
}

export async function executeNativeDump(script, output, { execute = run, env = process.env } = {}) {
  validateNativeDump(script);
  if (!env.ITA_PG_BIN || !env.ITA_BASH_BIN) throw new Error('NATIVE_BACKUP_TOOLS_REQUIRED');
  // Bash receives only runtime settings; login tokens, recovery keys and connection URLs stay out.
  const allowed = ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];
  const childEnv = Object.fromEntries(
    allowed.filter((name) => env[name]).map((name) => [name, env[name]]),
  );
  childEnv.PATH = `${env.ITA_PG_BIN}${delimiter}${env.PATH ?? env.Path ?? ''}`;
  childEnv.PGSSLMODE = /^export PGHOST="(?:127\.0\.0\.1|localhost|::1)"$/m.test(script)
    ? 'disable'
    : 'require';
  childEnv.PGCONNECT_TIMEOUT = '15';
  childEnv.PGOPTIONS = '-c statement_timeout=600000';
  await execute(env.ITA_BASH_BIN, ['--noprofile', '--norc', '-s'], {
    // CLI 2.117 emits the abbreviated singular flag. Windows pg_dump requires its full spelling.
    input: script.replace(/--quote-all-identifier(?=\s|$)/g, '--quote-all-identifiers'),
    output,
    env: childEnv,
  });
}

export async function createLinkedNativeBackup(output, recoveryKey) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const linked = (await readFile(join(root, 'supabase/.temp/project-ref'), 'utf8')).trim();
  if (linked !== PROJECT_REF) throw new Error('UNEXPECTED_SOURCE_PROJECT');
  if (!recoveryKey || Buffer.byteLength(recoveryKey) < 32)
    throw new Error('RECOVERY_KEY_REQUIRED_32_BYTES');
  const started = new Date().toISOString();
  return temporaryWork(async (directory) => {
    for (const [file, ...flags] of NATIVE_DUMPS) {
      // --dry-run may initialise Supabase's temporary login role. It never dumps data itself.
      // run captures stdout in memory and suppresses stderr. Never print or persist this script.
      const script = await run(
        process.execPath,
        [cli, 'db', 'dump', '--linked', '--dry-run', ...flags],
        { cwd: root },
      );
      await executeNativeDump(`${script}\n`, join(directory, file));
    }
    const files = {};
    for (const name of SQL_FILES)
      files[name] = {
        bytes: (await stat(join(directory, name))).size,
        sha256: await sha256(join(directory, name)),
      };
    if (!files['schema.sql'].bytes || !files['data.sql'].bytes) throw new Error('EMPTY_BACKUP');
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        format: 1,
        project: PROJECT_REF,
        started_at: started,
        completed_at: new Date().toISOString(),
        method: 'Supabase CLI 2.117.0 dry-run executed by native PostgreSQL tools',
        schemas: ['auth', 'public', 'ita_private', 'supabase_migrations'],
        auth: 'Actual Auth schema and data included. Restore requires compatible platform roles and a separately configured Auth service.',
        files,
      }),
      { mode: 0o600 },
    );
    const archive = join(directory, 'bundle.tar');
    await run('tar', ['-cf', archive, ...BUNDLE_FILES], { cwd: directory });
    await encryptFile(archive, output, recoveryKey);
    return { bytes: (await stat(output)).size, sha256: await sha256(output) };
  });
}

async function main() {
  if (process.argv.length !== 3) throw new Error('EXPECTED_ENCRYPTED_OUTPUT_PATH');
  const output = resolve(process.argv[2]);
  if (!output.endsWith('.ita.enc')) throw new Error('ENCRYPTED_EXTENSION_REQUIRED');
  await mkdir(resolve(output, '..'), { recursive: true });
  const result = await createLinkedNativeBackup(output, process.env.ITA_BACKUP_RECOVERY_KEY);
  console.log(`BACKUP_ENCRYPTED bytes=${result.bytes} sha256=${result.sha256}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      'NATIVE_BACKUP_FAILED: revisar herramientas, acceso CLI y conexión. Credenciales y SQL omitidos.',
    );
    process.exitCode = 1;
  });
