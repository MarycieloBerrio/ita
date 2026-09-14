import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { createTestDatabase } from './db-test.mjs';

const native = process.argv.includes('--native');
const db = await createTestDatabase(native);
try {
  const owner = randomUUID();
  const category = randomUUID();
  const service = randomUUID();
  await db.query('insert into auth.users(id) values($1)', [owner]);
  await db.query(
    "insert into ita_private.profiles(id,display_name,role) values($1,'Dueña ficticia benchmark','owner')",
    [owner],
  );
  await db.query(
    "insert into ita_private.categories(id,kind,name) values($1,'service','Categoría ficticia benchmark')",
    [category],
  );
  await db.query(
    "insert into ita_private.services(id,category_id,name,form_type,price_mode,fixed_price) values($1,$2,'Servicio ficticio','general','fixed',30000)",
    [service, category],
  );
  await db.query(
    "insert into ita_private.clients(id,name,phone,created_by) select md5('ita-bench-client-'||g)::uuid,'Clienta ficticia '||lpad(g::text,4,'0'),'300'||lpad(g::text,7,'0'),$1 from generate_series(1,2000) g",
    [owner],
  );
  await db.query(
    "insert into ita_private.visits(id,client_id,professional_id,starts_at,status,created_by) select md5('ita-bench-visit-'||g)::uuid,md5('ita-bench-client-'||(((g-1)%2000)+1))::uuid,$1,now()-(g%300)*interval '1 day','completed',$1 from generate_series(1,20000) g",
    [owner],
  );
  await db.query(
    'insert into ita_private.accounts(visit_id,client_id,professional_id) select id,client_id,professional_id from ita_private.visits',
  );
  await db.query(
    "insert into ita_private.visit_services(visit_id,service_id,name,path,form_type,price_mode,reference_price,price,technical,status,completed_at) select id,$1,'Servicio ficticio','Categoría ficticia benchmark / Servicio ficticio','general','fixed',30000,30000,ita_private.default_technical('general'),'completed',starts_at from ita_private.visits",
    [service],
  );
  await db.exec('analyze');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec('set role authenticated');
  const query = (action, payload) =>
    db
      .query('select public.app_query($1,$2::jsonb) result', [action, JSON.stringify(payload)])
      .then((r) => r.rows[0].result);
  const command = (action, payload) =>
    db
      .query('select public.app_command($1,$2::jsonb,$3) result', [
        action,
        JSON.stringify(payload),
        randomUUID(),
      ])
      .then((r) => r.rows[0].result);
  const times = { client_search: [], visit_search: [], client_save: [] };
  for (let index = 0; index < 65; index++) {
    let start = performance.now();
    const result = await query('clients', { search: String(1000 + index), limit: 50 });
    if (index >= 5) times.client_search.push(performance.now() - start);
    start = performance.now();
    await query('visits', { search: String(1000 + index), limit: 50 });
    if (index >= 5) times.visit_search.push(performance.now() - start);
    const client = result.items[0];
    start = performance.now();
    await command('client.save', { ...client, notes: `Nota ficticia de verificación ${index}` });
    if (index >= 5) times.client_save.push(performance.now() - start);
  }
  const statistics = Object.fromEntries(
    Object.entries(times).map(([name, entries]) => {
      const sorted = entries.toSorted((a, b) => a - b);
      return [
        name,
        {
          samples: sorted.length,
          median_ms: Number(sorted[29].toFixed(2)),
          p95_ms: Number(sorted[56].toFixed(2)),
          max_ms: Number(sorted.at(-1).toFixed(2)),
        },
      ];
    }),
  );
  const report = {
    timestamp: new Date().toISOString(),
    engine: db.engine ?? 'PGlite PostgreSQL WASM',
    fixture: { clients: 2000, visits: 20000, service_records: 20000, real_data: false },
    measurement:
      'Local database RPC round-trip only; excludes public network, Supabase Auth and Huawei rendering. Five warmup requests excluded.',
    statistics,
    database_bytes: native
      ? Number((await db.query('select pg_database_size(current_database()) bytes')).rows[0].bytes)
      : null,
    meets_local_targets:
      statistics.client_search.p95_ms < 2000 &&
      statistics.visit_search.p95_ms < 2000 &&
      statistics.client_save.p95_ms < 3000,
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/database-benchmark.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.close();
}
