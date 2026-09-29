// Native PostgreSQL execution of Supabase CLI dump scripts. CLI-generated credentials and scripts
// remain in memory. Used by the manual linked-project backup below and by `backup.mjs create`.
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseRecoveryKey } from './backup-crypto.mjs';
import {
  PROJECT_REF,
  excludedDataFlags,
  run,
  safeErrorSummary,
  temporaryWork,
  tlsSettings,
  writeEncryptedBundle,
} from './backup-common.mjs';

const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
/** Pinned local CLI when dependencies are installed; otherwise the `supabase` binary on PATH. */
export const supabaseCli = (args) =>
  existsSync(cli) ? [process.execPath, [cli, ...args]] : ['supabase', args];

export const NATIVE_DUMPS = [
  ['roles.sql', '--role-only'],
  // Including Auth explicitly makes its actual schema available for isolated PostgreSQL recovery.
  ['schema.sql', '--schema', 'auth,public,ita_private'],
  [
    'data.sql',
    '--use-copy',
    '--data-only',
    '--schema',
    'auth,public,ita_private',
    ...excludedDataFlags(),
  ],
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
    required.some((name) => !names.includes(name)) ||
    !/^export PGHOST="[^"]+"$/m.test(script)
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
  // Loopback disables TLS; any other host requires verify-full with ITA_PG_SSLROOTCERT.
  Object.assign(childEnv, tlsSettings(/^export PGHOST="([^"]+)"$/m.exec(script)[1], env));
  childEnv.PGCONNECT_TIMEOUT = '15';
  childEnv.PGOPTIONS = '-c statement_timeout=600000';
  await execute(env.ITA_BASH_BIN, ['--noprofile', '--norc', '-s'], {
    // CLI 2.117 emits an abbreviated flag and an unquoted schema alternation.
    // Quote only simple schema identifiers so Bash cannot interpret their pipes.
    input: script
      .replace(/--quote-all-identifier(?=\s|$)/g, '--quote-all-identifiers')
      .replace(
        /--schema=([a-zA-Z_][a-zA-Z0-9_]*(?:\|[a-zA-Z_][a-zA-Z0-9_]*)+)(?=\s|$)/g,
        "--schema='$1'",
      ),
    output,
    env: childEnv,
  });
}

export async function createLinkedNativeBackup(output, recoveryKey) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const linked = (await readFile(join(root, 'supabase/.temp/project-ref'), 'utf8')).trim();
  if (linked !== PROJECT_REF) throw new Error('UNEXPECTED_SOURCE_PROJECT');
  parseRecoveryKey(recoveryKey);
  tlsSettings('linked-remote-project'); // Fail before calling the CLI when no CA is configured.
  const started = new Date().toISOString();
  return temporaryWork(async (directory) => {
    for (const [file, ...flags] of NATIVE_DUMPS) {
      // --dry-run may initialise Supabase's temporary login role. It never dumps data itself.
      // run captures stdout in memory and suppresses stderr. Never print or persist this script.
      try {
        const [command, args] = supabaseCli(['db', 'dump', '--linked', '--dry-run', ...flags]);
        const script = await run(command, args, { cwd: root });
        await executeNativeDump(`${script}\n`, join(directory, file));
      } catch {
        throw new Error(`NATIVE_DUMP_FAILED_${file.replace('.', '_').toUpperCase()}`);
      }
    }
    return writeEncryptedBundle(directory, output, recoveryKey, {
      project: PROJECT_REF,
      started_at: started,
      method: 'Supabase CLI 2.117.0 dry-run executed by native PostgreSQL tools',
      schemas: ['auth', 'public', 'ita_private', 'supabase_migrations'],
      auth: 'Actual Auth schema and identity data included; sessions and tokens excluded. Restore requires compatible platform roles and a separately configured Auth service.',
    });
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
  main().catch((error) => {
    console.error(
      `NATIVE_BACKUP_FAILED ${safeErrorSummary(error, 'create')}: revisar herramientas, acceso CLI, CA TLS y conexión. Credenciales y SQL omitidos.`,
    );
    process.exitCode = 1;
  });
