import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { encryptFile } from './backup-crypto.mjs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

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

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * libpq TLS settings. Loopback connections disable TLS. Any other host requires certificate and
 * hostname verification (verify-full) against the CA file named by ITA_PG_SSLROOTCERT. The only
 * way to fall back to encrypted-but-unverified transport is the explicit, documented opt-out
 * ITA_PG_ALLOW_UNVERIFIED_TLS=true (never for the scheduled job).
 */
export function tlsSettings(host, env = process.env) {
  if (LOCAL_HOSTS.includes(host)) return { PGSSLMODE: 'disable' };
  const ca = env.ITA_PG_SSLROOTCERT;
  if (ca) {
    if (!isAbsolute(ca) || !existsSync(ca)) throw new Error('TLS_CA_FILE_NOT_FOUND');
    return { PGSSLMODE: 'verify-full', PGSSLROOTCERT: ca };
  }
  if (env.ITA_PG_ALLOW_UNVERIFIED_TLS === 'true') return { PGSSLMODE: 'require' };
  throw new Error('TLS_CA_REQUIRED_FOR_REMOTE_DATABASE');
}

const toolName = (command) =>
  basename(command)
    .replace(/\.(exe|cmd)$/i, '')
    .replace(/[^A-Za-z0-9]/g, '_')
    .toUpperCase();

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
      if (code !== 0 || outputError)
        reject(new Error(`BACKUP_TOOL_FAILED_${toolName(command)}_${code ?? 'SIGNAL'}`));
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
  const local = LOCAL_HOSTS.includes(url.hostname);
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
    ...tlsSettings(url.hostname),
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

// Ephemeral or credential-like Auth rows. Identities (auth.users, auth.identities, MFA factors)
// are kept so accounts and password hashes survive a restore; sessions, refresh tokens, one-time
// tokens, PKCE flow state, MFA challenges/claims and the Auth audit log are not needed to sign in
// again and would otherwise put live tokens and IP addresses in every copy. Table schemas are kept.
export const EXCLUDED_DATA_TABLES = [
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.one_time_tokens',
  'auth.flow_state',
  'auth.mfa_challenges',
  'auth.mfa_amr_claims',
  'auth.audit_log_entries',
  'storage.buckets_vectors',
  'storage.vector_indexes',
];
export const excludedDataFlags = () => EXCLUDED_DATA_TABLES.flatMap((table) => ['-x', table]);

/** Hashes the SQL files, writes the manifest, archives and encrypts. Returns ciphertext facts. */
export async function writeEncryptedBundle(directory, output, recoveryKey, manifest) {
  const files = {};
  for (const name of SQL_FILES) {
    const path = join(directory, name);
    files[name] = { bytes: (await stat(path)).size, sha256: await sha256(path) };
  }
  if (!files['schema.sql'].bytes || !files['data.sql'].bytes) throw new Error('EMPTY_BACKUP');
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      format: 1,
      ...manifest,
      completed_at: new Date().toISOString(),
      excluded_data: EXCLUDED_DATA_TABLES,
      files,
    }),
    { mode: 0o600 },
  );
  const archive = join(directory, 'bundle.tar');
  await run('tar', ['-cf', archive, ...BUNDLE_FILES], { cwd: directory });
  await encryptFile(archive, output, recoveryKey);
  return { bytes: (await stat(output)).size, sha256: await sha256(output) };
}

/**
 * Maps an error to a short, non-sensitive diagnostic. Only our own UPPER_SNAKE codes, Node system
 * error codes and the step name are printed; messages from tools may contain URLs or SQL rows.
 */
export function safeErrorSummary(error, step) {
  const message = error instanceof Error ? error.message : '';
  const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : 'UNCLASSIFIED';
  const system =
    error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(error.code)
      ? error.code
      : '-';
  const type =
    error instanceof Error ? error.constructor.name.replace(/[^A-Za-z]/g, '') : 'Unknown';
  return `step=${String(step).replace(/[^a-z0-9-]/gi, '')} code=${code} system=${system} type=${type}`;
}
