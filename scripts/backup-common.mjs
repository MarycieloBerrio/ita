import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export const PROJECT_REF = 'mrnzvgivfjivuobpgens';
export const SQL_FILES = [
  'roles.sql',
  'schema.sql',
  'data.sql',
  'history_schema.sql',
  'history_data.sql',
];
export const BUNDLE_FILES = ['manifest.json', ...SQL_FILES];
export const executable = (name) =>
  process.env.ITA_PG_BIN && ['psql', 'pg_dump', 'createdb'].includes(name)
    ? join(process.env.ITA_PG_BIN, name + (process.platform === 'win32' ? '.exe' : ''))
    : name;

export async function run(command, args, { env = process.env, cwd, output, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const childEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          ![
            'ITA_BACKUP_RECOVERY_KEY',
            'GITHUB_TOKEN',
            'ITA_BACKUP_DATABASE_URL',
            'ITA_RESTORE_DATABASE_URL',
          ].includes(name),
      ),
    );
    const child = spawn(executable(command), args, {
      env: childEnv,
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let captured = '',
      outputError;
    const destination = output ? createWriteStream(output, { flags: 'wx', mode: 0o600 }) : null;
    if (destination) {
      destination.on('error', (error) => {
        outputError = error;
        child.kill();
      });
      child.stdout.pipe(destination);
    } else
      child.stdout.on('data', (chunk) => {
        captured += chunk;
        if (captured.length > 2_000_000) child.kill();
      });
    child.stderr.resume(); // CLI failures may echo connection strings or SQL rows. Never log stderr.
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error('BACKUP_TOOL_UNAVAILABLE')));
    child.on('close', async (code) => {
      if (destination && !destination.closed)
        await new Promise((done) => destination.on('close', done));
      if (code !== 0 || outputError) reject(new Error(`BACKUP_TOOL_FAILED_${command}_${code}`));
      else resolvePromise(captured.trim());
    });
    child.stdin.end(input);
  });
}

export function postgresEnv(connection, { localOnly = false, expectedDatabase } = {}) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    throw new Error('DATABASE_URL_REQUIRED');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('INVALID_DATABASE_URL');
  const database = decodeURIComponent(url.pathname.slice(1));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    localOnly &&
    (!local || !/^ita_restore_[a-z0-9_]+$/.test(database) || database !== expectedDatabase)
  )
    throw new Error('RESTORE_REQUIRES_EXPLICIT_SEPARATE_LOCAL_DATABASE');
  // Whitelist libpq fields: URL query options cannot redirect connection or execute commands.
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PG'))),
    PGHOST: url.hostname === '[::1]' ? '::1' : url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: local ? 'disable' : 'require',
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c statement_timeout=600000',
  };
}

export async function temporaryWork(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'ita-backup-'));
  const absolute = resolve(directory),
    root = resolve(tmpdir()) + sep;
  if (!absolute.startsWith(root) || !absolute.split(sep).at(-1).startsWith('ita-backup-'))
    throw new Error('UNSAFE_TEMPORARY_PATH');
  try {
    return await fn(directory);
  } finally {
    await rm(absolute, { recursive: true, force: true });
  }
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
