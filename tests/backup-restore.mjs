// Native PostgreSQL recovery test. Fictional data only; no hosted Auth service is involved.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import {
  BUNDLE_FILES,
  SQL_FILES,
  postgresEnv,
  run,
  sha256,
  temporaryWork,
} from '../scripts/backup-common.mjs';
import { encryptFile } from '../scripts/backup-crypto.mjs';
import { restoreBackup } from '../scripts/restore.mjs';

const adminUrl = process.env.ITA_TEST_DATABASE_URL;
if (!adminUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(adminUrl).hostname))
  throw new Error('ITA_TEST_DATABASE_URL debe apuntar a un clúster local desechable.');
const suffix = randomUUID().replaceAll('-', '');
const sourceName = `ita_backup_source_${suffix}`,
  targetName = `ita_restore_${suffix}`;
const connectionFor = (name) => {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
};
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const clients = [];
try {
  for (const name of [sourceName, targetName]) await admin.query(`create database "${name}"`);
  for (const role of ['anon', 'authenticated', 'service_role'])
    await admin.query(
      `do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`,
    );
  const source = new pg.Client({ connectionString: connectionFor(sourceName) });
  await source.connect();
  clients.push(source);
  await source.query(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);`);
  for (const file of (await readdir('supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await source.query(await readFile(join('supabase/migrations', file), 'utf8'));
    await source.query('insert into supabase_migrations.schema_migrations values($1)', [file]);
  }
  const owner = randomUUID(),
    worker = randomUUID();
  await source.query('insert into auth.users values($1),($2)', [owner, worker]);
  await source.query(
    "insert into ita_private.profiles(id,display_name,role) values($1,'Dueña ficticia','owner'),($2,'Trabajadora ficticia','worker')",
    [owner, worker],
  );
  await source.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await source.query('set role authenticated');
  const command = async (action, payload) =>
    (
      await source.query('select public.app_command($1,$2::jsonb,$3) result', [
        action,
        JSON.stringify(payload),
        randomUUID(),
      ])
    ).rows[0].result;
  const query = async (client, action, payload = {}) =>
    (
      await client.query('select public.app_query($1,$2::jsonb) result', [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  const client = await command('client.save', {
    name: 'Clienta de recuperación ficticia',
    birth_day: 29,
    birth_month: 2,
  });
  const category = await command('category.save', { kind: 'service', name: 'Servicios ficticios' });
  const services = [];
  for (const [name, price] of [
    ['Trabajo A', 200000],
    ['Trabajo B', 30000],
  ])
    services.push(
      await command('service.save', {
        category_id: category.id,
        name,
        form_type: 'general',
        price_mode: 'fixed',
        fixed_price: price,
        duration_minutes: 30,
      }),
    );
  const method = await command('payment_method.save', { name: 'Efectivo ficticio', is_cash: true });
  const visit = await command('visit.create', {
    client_id: client.id,
    service_ids: services.map((s) => s.id),
  });
  const detail = await query(source, 'visit', { id: visit.id });
  for (const service of detail.services)
    await command('service_record.save', {
      id: service.id,
      version: service.version,
      technical: service.technical,
      status: 'completed',
    });
  await command('payment.record', {
    account_id: visit.account_id,
    amount: 100000,
    method_id: method.id,
    paid_at: new Date().toISOString(),
  });
  const productCategory = await command('category.save', {
    name: 'Inventario ficticio',
    kind: 'product',
  });
  const product = await command('product.save', {
    category_id: productCategory.id,
    name: 'Producto ficticio',
    usage: 'both',
    sale_price: 15000,
    cost: 7000,
  });
  await command('inventory.move', {
    product_id: product.id,
    quantity: 3,
    kind: 'initial',
    reason: 'Conteo ficticio',
  });
  await command('inventory.move', {
    product_id: product.id,
    quantity: -1,
    kind: 'consumption',
    reason: 'Uso ficticio',
  });
  const ap = {
    client_id: client.id,
    starts_at: '2027-10-12T15:00:00Z',
    ends_at: '2027-10-12T16:00:00Z',
    service_ids: [services[0].id],
  };
  await command('appointment.save', { ...ap, professional_id: owner });
  await command('appointment.save', { ...ap, professional_id: worker });
  await source.query('reset role');
  const tables = (
    await source.query(
      "select tablename from pg_tables where schemaname='ita_private' order by tablename",
    )
  ).rows.map((r) => r.tablename);
  const snapshot = async (db) => {
    const output = {};
    for (const table of tables)
      output[table] = (
        await db.query(
          `select to_jsonb(t) as row from ita_private."${table}" t order by to_jsonb(t)::text`,
        )
      ).rows;
    return output;
  };
  const before = await snapshot(source);
  await temporaryWork(async (directory) => {
    // Hosted Supabase provides auth schema/platform roles. This local fixture dumps its auth stub explicitly.
    await writeFile(
      join(directory, 'roles.sql'),
      '-- Local test: platform roles already exist in this isolated cluster.\n',
    );
    await run('pg_dump', ['--schema-only', '--no-owner', '--exclude-schema=supabase_migrations'], {
      env: postgresEnv(connectionFor(sourceName)),
      output: join(directory, 'schema.sql'),
    });
    await run(
      'pg_dump',
      ['--data-only', '--no-owner', '--column-inserts', '--exclude-schema=supabase_migrations'],
      { env: postgresEnv(connectionFor(sourceName)), output: join(directory, 'data.sql') },
    );
    await run('pg_dump', ['--schema-only', '--no-owner', '--schema=supabase_migrations'], {
      env: postgresEnv(connectionFor(sourceName)),
      output: join(directory, 'history_schema.sql'),
    });
    await run(
      'pg_dump',
      ['--data-only', '--no-owner', '--column-inserts', '--schema=supabase_migrations'],
      { env: postgresEnv(connectionFor(sourceName)), output: join(directory, 'history_data.sql') },
    );
    const files = {};
    for (const name of SQL_FILES)
      files[name] = {
        bytes: (await stat(join(directory, name))).size,
        sha256: await sha256(join(directory, name)),
      };
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        format: 1,
        project: 'local-fictional-fixture',
        completed_at: new Date().toISOString(),
        files,
      }),
    );
    const archive = join(directory, 'bundle.tar'),
      encrypted = join(directory, 'fixture.ita.enc');
    await run('tar', ['-cf', archive, ...BUNDLE_FILES], { cwd: directory });
    await encryptFile(archive, encrypted, 'clave-ficticia-exclusiva-de-prueba-123456789');
    await restoreBackup(
      encrypted,
      connectionFor(targetName),
      'clave-ficticia-exclusiva-de-prueba-123456789',
      targetName,
    );
    const target = new pg.Client({ connectionString: connectionFor(targetName) });
    await target.connect();
    clients.push(target);
    assert.deepEqual(await snapshot(target), before, 'Every application table preserved exactly');
    assert.equal((await target.query('select count(*) from auth.users')).rows[0].count, '2');
    assert.deepEqual(
      (await target.query('select * from supabase_migrations.schema_migrations order by version'))
        .rows,
      (await source.query('select * from supabase_migrations.schema_migrations order by version'))
        .rows,
    );
    await target.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await target.query('set role authenticated');
    assert.equal((await query(target, 'bootstrap')).profile.role, 'owner');
    assert.equal((await query(target, 'visit', { id: visit.id })).account.balance, 130000);
    assert.equal((await query(target, 'inventory')).products[0].stock, 2);
    await target.query('reset role');
    await target.query("select set_config('request.jwt.claim.sub',$1,false)", [worker]);
    await target.query('set role authenticated');
    assert.equal((await query(target, 'bootstrap')).profile.role, 'worker');
    assert.equal(
      (await query(target, 'appointments', { from: '2027-10-01', to: '2027-10-31' })).items.length,
      1,
    );
    await assert.rejects(() => query(target, 'visit', { id: visit.id }));
    await assert.rejects(() => query(target, 'finance'));
    await target.query('reset role');
    const birthdays = (
      await target.query("select ita_private.birthday_events('2027-02-01','2027-02-28') result")
    ).rows[0].result;
    assert.equal(birthdays[0].date, '2027-02-28');
    await assert.rejects(
      () =>
        restoreBackup(
          encrypted,
          connectionFor(targetName),
          'clave-ficticia-exclusiva-de-prueba-123456789',
          targetName,
        ),
      /NOT_EMPTY/,
    );
    console.log(
      `PASS: restauración PostgreSQL nativo; ${tables.length} tablas idénticas, 2 identidades/RLS, historial migraciones, cuenta $230000/abono $100000/saldo $130000, stock 2, agenda privada y cumpleaños. Artefacto cifrado ${(await stat(encrypted)).size} bytes. Auth HTTP hospedado pendiente.`,
    );
  });
} finally {
  for (const client of clients) await client.end();
  // Exact names are generated above; never drop a provided database or the source service.
  for (const name of [sourceName, targetName])
    await admin.query(`drop database if exists "${name}"`);
  await admin.end();
}
