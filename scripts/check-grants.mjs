// Applies every migration to an embedded PGlite database that reproduces Supabase's default
// privileges (functions created in `public` are granted to anon/authenticated/service_role
// explicitly, not only through PUBLIC) and fails if an anonymous caller could execute any function
// in `public` or `ita_private`, or if `authenticated` gained a public RPC outside the allowlist.
// Fictional, local and in-memory only: never connects to a remote database.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';

// The only RPCs the browser may call (docs/api.md). Adding one requires updating docs and this list.
const AUTHENTICATED_RPC_ALLOWLIST = new Set([
  'public.app_query(text,jsonb)',
  'public.app_command(text,jsonb,uuid)',
]);

const db = new PGlite();
try {
  await db.exec(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    -- Supabase grants these explicitly on the public schema; a REVOKE ... FROM PUBLIC is not enough.
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  const files = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    } catch (error) {
      console.error(`GRANTS_CHECK_MIGRATION_FAILED ${file}: ${error.message}`);
      throw error;
    }
  }
  const { rows } = await db.query(`
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
           regexp_replace(n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', ', ', ',', 'g') as normalized,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           n.nspname as schema
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'ita_private')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     order by 1`);
  const problems = [];
  for (const row of rows) {
    if (row.anon) problems.push(`anon puede ejecutar ${row.signature}`);
    if (
      row.schema === 'public' &&
      row.authenticated &&
      !AUTHENTICATED_RPC_ALLOWLIST.has(row.normalized)
    )
      problems.push(`authenticated puede ejecutar ${row.signature} (fuera de la lista permitida)`);
  }
  for (const rpc of AUTHENTICATED_RPC_ALLOWLIST)
    if (!rows.some((row) => row.normalized === rpc && row.authenticated))
      problems.push(`authenticated no puede ejecutar ${rpc}`);
  if (problems.length) {
    console.error(
      `GRANTS_CHECK_FAILED (${problems.length}). Añadir "revoke all on function ... from public, anon, authenticated" en una migración nueva:\n- ${problems.join('\n- ')}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      `PASS: ${files.length} migraciones; ${rows.length} funciones en public/ita_private; anon no ejecuta ninguna; authenticated solo ${[...AUTHENTICATED_RPC_ALLOWLIST].join(', ')}.`,
    );
} finally {
  await db.close();
}
