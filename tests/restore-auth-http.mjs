import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, createHmac } from 'node:crypto';
import { Client } from 'pg';
import { postgresEnv } from '../scripts/backup-common.mjs';
// This test changes passwords ONLY in the explicitly confirmed local restore destination.
const settings = postgresEnv(process.env.ITA_RESTORE_DATABASE_URL, {
  localOnly: true,
  expectedDatabase: process.env.ITA_RESTORE_DATABASE,
});
const target = {
  name: settings.PGDATABASE,
  cfg: {
    host: settings.PGHOST,
    port: Number(settings.PGPORT),
    user: settings.PGUSER,
    password: settings.PGPASSWORD,
    database: settings.PGDATABASE,
  },
};
assert.ok(
  process.env.ITA_AUTH_TEST_BINARY && process.env.ITA_RESTORE_ACCOUNTS_FILE,
  'RESTORE_TEST_INPUTS_REQUIRED',
);
const databaseUrl = new URL('postgresql://127.0.0.1');
databaseUrl.hostname = settings.PGHOST;
databaseUrl.port = settings.PGPORT;
databaseUrl.pathname = '/' + settings.PGDATABASE;
databaseUrl.username = settings.PGUSER;
databaseUrl.password = settings.PGPASSWORD;
databaseUrl.searchParams.set('sslmode', 'disable');
databaseUrl.searchParams.set('search_path', 'auth');
const delivery = JSON.parse(await readFile(process.env.ITA_RESTORE_ACCOUNTS_FILE, 'utf8'));
assert.equal(delivery.cuentas.length, 2);
assert.deepEqual(delivery.cuentas.map((a) => a.rol).sort(), ['Dueña', 'Trabajadora']);
const secret = randomBytes(48).toString('base64url');
const reservation = createServer();
await new Promise((done, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', done);
});
const port = String(reservation.address().port);
await new Promise((done) => reservation.close(done));
const base = `http://127.0.0.1:${port}`;
const encode = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
const payload = encode({
  role: 'service_role',
  aud: 'authenticated',
  iss: 'ita-restore-test',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 600,
});
const head = encode({ alg: 'HS256', typ: 'JWT' });
const body = `${head}.${payload}`;
const adminToken = body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
const env = {
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  PATH: process.env.PATH ?? process.env.Path,
  LOG_LEVEL: 'error',
  GOTRUE_JWT_SECRET: secret,
  GOTRUE_JWT_EXP: '3600',
  GOTRUE_JWT_AUD: 'authenticated',
  GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
  GOTRUE_JWT_ADMIN_ROLES: 'service_role',
  GOTRUE_DB_DRIVER: 'postgres',
  DATABASE_URL: databaseUrl.toString(),
  DB_NAMESPACE: 'auth',
  API_EXTERNAL_URL: base,
  GOTRUE_API_HOST: '127.0.0.1',
  PORT: port,
  GOTRUE_SITE_URL: base,
  GOTRUE_URI_ALLOW_LIST: base + '/recuperar',
  GOTRUE_DISABLE_SIGNUP: 'true',
  GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
  GOTRUE_MAILER_AUTOCONFIRM: 'false',
  GOTRUE_PASSWORD_MIN_LENGTH: '12',
  GOTRUE_DB_MAX_POOL_SIZE: '5',
  GOTRUE_DB_ADVISOR_ENABLED: 'false',
  GOTRUE_DB_CLEANUP_ENABLED: 'false',
};
const server = spawn(resolve(process.env.ITA_AUTH_TEST_BINARY), ['serve'], {
  windowsHide: true,
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
});
let diagnostics = '';
server.stderr.on('data', (p) => (diagnostics += p));
server.on('error', () => {});
const db = new Client({ ...target.cfg, database: target.name });
const request = async (path, method = 'GET', data, token) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error('AUTH_HTTP_' + r.status + '_' + path.replace(/[^a-z_]/gi, '_'));
  return r.status === 204 ? {} : r.json();
};
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      await request('/health');
      ready = true;
      break;
    } catch {
      if (server.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!ready) throw Error('AUTH_START_FAILED');
  await db.connect();
  let passed = 0;
  for (const account of delivery.cuentas) {
    let login = await request('/token?grant_type=password', 'POST', {
      email: account.correo,
      password: account.contraseña,
    });
    assert.ok(login.access_token && login.user.id);
    passed++;
    const tokenParts = login.access_token.split('.');
    assert.equal(
      createHmac('sha256', secret).update(tokenParts.slice(0, 2).join('.')).digest('base64url'),
      tokenParts[2],
    );
    const claims = JSON.parse(Buffer.from(tokenParts[1], 'base64url'));
    assert.equal(claims.sub, login.user.id);
    passed++;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [claims.sub]);
    await db.query('set role authenticated');
    const role = (await db.query("select public.app_query('bootstrap','{}') result")).rows[0].result
      .profile.role;
    assert.equal(role, account.rol === 'Dueña' ? 'owner' : 'worker');
    passed++;
    if (role === 'worker') {
      await assert.rejects(db.query("select public.app_query('finance','{}')"), { code: '42501' });
      passed++;
    }
    await db.query('reset role');
    const link = await request(
      '/admin/generate_link',
      'POST',
      { type: 'recovery', email: account.correo, redirect_to: base + '/recuperar' },
      adminToken,
    );
    assert.ok(link.hashed_token);
    passed++;
    const recovered = await request('/verify', 'POST', {
      type: 'recovery',
      token_hash: link.hashed_token,
    });
    assert.ok(recovered.access_token);
    passed++;
    const password = randomBytes(24).toString('base64url');
    await request('/user', 'PUT', { password }, recovered.access_token);
    passed++;
    login = await request('/token?grant_type=password', 'POST', {
      email: account.correo,
      password,
    });
    assert.equal(login.user.id, claims.sub);
    passed++;
    await request('/logout', 'POST', {}, login.access_token);
    passed++;
  }
  const report = {
    date: new Date().toISOString(),
    authVersion: 'v2.196.0',
    environment: '127.0.0.1 isolated restored PostgreSQL',
    checks: passed,
    accounts: 2,
    login: true,
    tokenSignature: true,
    roles: true,
    workerFinanceDenied: true,
    recoveryWithoutSendingEmail: true,
    newPasswordLogin: true,
    logout: true,
    productionChanged: false,
  };
  if (process.env.ITA_AUTH_RESTORE_REPORT)
    await writeFile(process.env.ITA_AUTH_RESTORE_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(
    JSON.stringify({
      status: 'FAILED',
      code: /^AUTH_[A-Za-z0-9_]+$/.test(error.message)
        ? error.message
        : 'AUTH_RESTORE_ASSERTION_FAILED',
      configuration: /load config|required key|invalid value/i.test(diagnostics),
      connection: /opening database|connection refused/i.test(diagnostics),
      sql: /SQLSTATE/i.test(diagnostics),
      sqlstates: [...diagnostics.matchAll(/SQLSTATE ([A-Z0-9]{5})/g)].map((m) => m[1]),
    }),
  );
  process.exitCode = 1;
} finally {
  server.kill();
  await db.end().catch(() => {});
}
