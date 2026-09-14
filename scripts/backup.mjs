import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptFile } from './backup-crypto.mjs';
import {
  BUNDLE_FILES,
  PROJECT_REF,
  SQL_FILES,
  postgresEnv,
  run,
  sha256,
  temporaryWork,
} from './backup-common.mjs';
import { prepareRetention } from './backup-retention.mjs';

export async function createBackup(output, connection, recoveryKey) {
  const url = new URL(connection);
  const isDirect = url.hostname === `db.${PROJECT_REF}.supabase.co`;
  const isPooler =
    url.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(url.username) === `postgres.${PROJECT_REF}`;
  if (!isDirect && !isPooler) throw new Error('UNEXPECTED_SOURCE_PROJECT');
  if (!recoveryKey || Buffer.byteLength(recoveryKey) < 32)
    throw new Error('RECOVERY_KEY_REQUIRED_32_BYTES');
  const started = new Date().toISOString();
  return temporaryWork(async (directory) => {
    const commands = [
      ['roles.sql', '--role-only'],
      ['schema.sql'],
      [
        'data.sql',
        '--use-copy',
        '--data-only',
        '-x',
        'storage.buckets_vectors',
        '-x',
        'storage.vector_indexes',
      ],
      ['history_schema.sql', '--schema', 'supabase_migrations'],
      ['history_data.sql', '--use-copy', '--data-only', '--schema', 'supabase_migrations'],
    ];
    for (const [file, ...flags] of commands)
      await run('supabase', [
        'db',
        'dump',
        '--db-url',
        connection,
        '-f',
        join(directory, file),
        ...flags,
      ]);
    const files = {};
    for (const file of SQL_FILES)
      files[file] = {
        bytes: (await stat(join(directory, file))).size,
        sha256: await sha256(join(directory, file)),
      };
    if (!files['schema.sql'].bytes || !files['data.sql'].bytes) throw new Error('EMPTY_BACKUP');
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        format: 1,
        project: PROJECT_REF,
        started_at: started,
        completed_at: new Date().toISOString(),
        commit: process.env.GITHUB_SHA || null,
        auth: 'Auth data included by Supabase CLI; destination requires compatible managed Auth schema and configuration.',
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
  main().catch(() => {
    console.error(
      'BACKUP_FAILED: revisar credenciales, herramientas, conexión o cuota. No se muestran datos del volcado.',
    );
    process.exitCode = 1;
  });
