import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decryptFile } from './backup-crypto.mjs';
import {
  BUNDLE_FILES,
  SQL_FILES,
  postgresEnv,
  run,
  sha256,
  temporaryWork,
} from './backup-common.mjs';

export async function restoreBackup(file, connection, recoveryKey, expectedDatabase) {
  const env = postgresEnv(connection, { localOnly: true, expectedDatabase });
  // No DROP, TRUNCATE or --clean. Abort if destination already contains app records/schema.
  const exists = await run(
    'psql',
    [
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "select exists(select 1 from pg_namespace where nspname='ita_private')",
    ],
    { env },
  );
  if (exists !== 'f') throw new Error('RESTORE_DESTINATION_NOT_EMPTY');
  await run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    env,
    input: `do $$ declare occupied boolean; begin
      if to_regclass('auth.users') is not null then
        execute 'select exists(select 1 from auth.users)' into occupied;
        if occupied then raise exception 'RESTORE_DESTINATION_AUTH_NOT_EMPTY'; end if;
      end if;
    end $$;`,
  });
  return temporaryWork(async (directory) => {
    const archive = join(directory, 'restore.tar');
    // SQL is never executed until the entire ciphertext has passed GCM authentication.
    await decryptFile(file, archive, recoveryKey);
    const names = (await run('tar', ['-tf', archive])).split(/\r?\n/).sort();
    if (JSON.stringify(names) !== JSON.stringify([...BUNDLE_FILES].sort()))
      throw new Error('INVALID_BACKUP_CONTENTS');
    for (const name of BUNDLE_FILES)
      await run('tar', ['-xOf', archive, name], { output: join(directory, name) });
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.format !== 1) throw new Error('UNSUPPORTED_BACKUP_FORMAT');
    for (const name of SQL_FILES) {
      const metadata = manifest.files[name],
        path = join(directory, name);
      if (
        !metadata ||
        metadata.bytes !== (await stat(path)).size ||
        metadata.sha256 !== (await sha256(path))
      )
        throw new Error('BACKUP_FILE_HASH_MISMATCH');
    }
    await run(
      'psql',
      [
        '-X',
        '--single-transaction',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        join(directory, 'roles.sql'),
        '-f',
        join(directory, 'schema.sql'),
        '-c',
        'SET session_replication_role = replica',
        '-f',
        join(directory, 'data.sql'),
        '-f',
        join(directory, 'history_schema.sql'),
        '-f',
        join(directory, 'history_data.sql'),
      ],
      { env },
    );
    return { project: manifest.project, completed_at: manifest.completed_at };
  });
}

async function main() {
  const [file, confirmation, database] = process.argv.slice(2);
  if (!file || confirmation !== '--confirm-local-target' || !database)
    throw new Error('USAGE_RESTORE_FILE_CONFIRM_LOCAL_TARGET_DATABASE');
  await restoreBackup(
    resolve(file),
    process.env.ITA_RESTORE_DATABASE_URL,
    process.env.ITA_BACKUP_RECOVERY_KEY,
    database,
  );
  console.log(
    'RESTORE_SQL_COMPLETED: verificar los datos y probar el acceso de ambas cuentas antes de operar.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error(
      'RESTORE_FAILED: destino, cifrado, esquema o conexión no válidos. No se muestran datos del volcado.',
    );
    process.exitCode = 1;
  });
