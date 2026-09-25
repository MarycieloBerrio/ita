import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseRecoveryKey } from './backup-crypto.mjs';
import {
  LOCAL_HOSTS,
  PROJECT_REF,
  excludedDataFlags,
  postgresEnv,
  run,
  safeErrorSummary,
  temporaryWork,
  tlsSettings,
  writeEncryptedBundle,
} from './backup-common.mjs';
import { executeNativeDump, supabaseCli } from './backup-native.mjs';
import { prepareRetention } from './backup-retention.mjs';

// Supabase's documented backup split: roles, schema (platform schemas excluded), data via COPY
// (Auth identities included, ephemeral Auth tables excluded) and migration history.
export const SCHEDULED_DUMPS = [
  ['roles.sql', '--role-only'],
  ['schema.sql'],
  ['data.sql', '--use-copy', '--data-only', ...excludedDataFlags()],
  ['history_schema.sql', '--schema', 'supabase_migrations'],
  ['history_data.sql', '--use-copy', '--data-only', '--schema', 'supabase_migrations'],
];

export function assertProjectSource(connection) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    throw new Error('DATABASE_URL_REQUIRED');
  }
  const isDirect = url.hostname === `db.${PROJECT_REF}.supabase.co`;
  const isPooler =
    url.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(url.username) === `postgres.${PROJECT_REF}`;
  if (!isDirect && !isPooler) throw new Error('UNEXPECTED_SOURCE_PROJECT');
  return url;
}

/**
 * The CLI only generates the pg_dump script (--dry-run); native PostgreSQL tools execute it so
 * TLS verification (verify-full + CA) is under our control instead of a Docker container's.
 * `adaptScript` exists solely for the local CI fixture (e.g. its administrator is not `postgres`).
 */
export async function cliDump(
  connection,
  file,
  flags,
  directory,
  adaptScript = (script) => script,
) {
  const [command, args] = supabaseCli([
    'db',
    'dump',
    '--db-url',
    connection,
    '--dry-run',
    ...flags,
  ]);
  let script;
  try {
    script = await run(command, args);
  } catch {
    throw new Error(`CLI_DUMP_SCRIPT_FAILED_${file.replace('.', '_').toUpperCase()}`);
  }
  // The CLI prints a banner before the script; keep only the script itself.
  const start = script.indexOf('#!/usr/bin/env bash');
  if (start < 0) throw new Error('UNEXPECTED_CLI_DUMP_SCRIPT');
  try {
    await executeNativeDump(`${adaptScript(script.slice(start), file)}\n`, join(directory, file));
  } catch (error) {
    if (/^(TLS_|NATIVE_BACKUP_TOOLS|UNEXPECTED_CLI)/.test(error.message)) throw error;
    throw new Error(`NATIVE_DUMP_FAILED_${file.replace('.', '_').toUpperCase()}`);
  }
}

/**
 * Creates an encrypted bundle. The scheduled job always validates the source project. The local
 * restore test passes `localTestSource: true` (loopback only) to exercise this same code path.
 */
export async function createBackup(
  output,
  connection,
  recoveryKey,
  { localTestSource = false, adaptScript, dump = cliDump } = {},
) {
  parseRecoveryKey(recoveryKey);
  let url;
  if (localTestSource) {
    url = new URL(connection);
    if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error('LOCAL_TEST_SOURCE_MUST_BE_LOOPBACK');
  } else url = assertProjectSource(connection);
  tlsSettings(url.hostname); // Fail closed before running any tool without a CA for remote hosts.
  const started = new Date().toISOString();
  return temporaryWork(async (directory) => {
    for (const [file, ...flags] of SCHEDULED_DUMPS)
      await dump(connection, file, flags, directory, adaptScript);
    return writeEncryptedBundle(directory, output, recoveryKey, {
      project: localTestSource ? 'local-fictional-fixture' : PROJECT_REF,
      started_at: started,
      commit: process.env.GITHUB_SHA || null,
      method: 'Supabase CLI 2.117.0 dry-run executed by native PostgreSQL tools',
      auth: 'Auth identity data included by Supabase CLI (sessions/tokens excluded); destination requires compatible managed Auth schema and configuration.',
    });
  });
}

export async function publishStatus(status) {
  if (!['running', 'success', 'failed'].includes(status)) throw new Error('INVALID_BACKUP_STATUS');
  const runKey = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  if (!/^\d+-\d+$/.test(runKey)) throw new Error('INVALID_BACKUP_RUN');
  const name = process.env.ITA_BACKUP_ARTIFACT_NAME || '';
  if (name && !/^ita-backup-\d{8}-\d+-\d+$/.test(name)) throw new Error('INVALID_ARTIFACT_NAME');
  const bytes = Number(process.env.ITA_BACKUP_BYTES || 0);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('INVALID_BACKUP_SIZE');
  await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env: postgresEnv(process.env.ITA_BACKUP_DATABASE_URL),
    input: `insert into ita_private.backup_status(run_key,started_at,completed_at,status,message,bytes,artifact_name)
      values ('${runKey}',now(),${status === 'running' ? 'null' : 'now()'},'${status}','${status === 'failed' ? 'BACKUP_RUN_FAILED' : ''}',${bytes},'${name}')
      on conflict(run_key) do update set completed_at=excluded.completed_at,status=excluded.status,message=excluded.message,bytes=excluded.bytes,artifact_name=excluded.artifact_name;`,
  });
}

async function main() {
  if (process.argv[2] === 'status') return publishStatus(process.argv[3]);
  if (process.argv[2] !== 'create') throw new Error('USE_BACKUP_CREATE_OR_STATUS');
  const name = `ita-backup-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  if (!/^ita-backup-\d{8}-\d+-\d+$/.test(name)) throw new Error('GITHUB_RUN_REQUIRED');
  if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP_REQUIRED');
  const directory = resolve(process.env.RUNNER_TEMP, 'ita-encrypted-output');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${name}.ita.enc`);
  const result = await createBackup(
    file,
    process.env.ITA_BACKUP_DATABASE_URL,
    process.env.ITA_BACKUP_RECOVERY_KEY,
  );
  await prepareRetention(file);
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `path=${file}\nname=${name}\nbytes=${result.bytes}\nsha256=${result.sha256}\n`,
  );
  console.log(`BACKUP_ENCRYPTED bytes=${result.bytes} sha256=${result.sha256}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    // Only a classified code is printed: tool output may contain connection strings or rows.
    console.error(
      `BACKUP_FAILED ${safeErrorSummary(error, process.argv[2] === 'status' ? `status-${process.argv[3]}` : 'create')}. No se muestran datos del volcado ni credenciales.`,
    );
    process.exitCode = 1;
  });
