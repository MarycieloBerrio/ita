import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyExports(db, { owner, worker, color }) {
  let checks = 0;
  const check = (value, expected, message) => {
    assert.deepEqual(value, expected, message);
    checks++;
  };
  const denied = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  const get = (payload) =>
    db
      .query("select public.app_query('export',$1::jsonb) result", [JSON.stringify(payload)])
      .then((r) => r.rows[0].result);
  const cmd = (action, payload) =>
    db
      .query('select public.app_command($1,$2::jsonb,$3) result', [
        action,
        JSON.stringify(payload),
        randomUUID(),
      ])
      .then((r) => r.rows[0].result);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec('set role authenticated');
  const client = await cmd('client.save', {
    name: 'Clienta integral ficticia',
    notes: '</script><img src=x> · fórmula libre “8/31”',
  });
  await db.exec('reset role');
  await db.query(
    'insert into ita_private.visits(client_id,professional_id,created_by) select $1,$2,$2 from generate_series(1,55)',
    [client.id, owner],
  );
  await db.query(
    'insert into ita_private.accounts(visit_id,client_id,professional_id) select id,client_id,professional_id from ita_private.visits where client_id=$1',
    [client.id],
  );
  await db.query(
    "insert into ita_private.visit_services(visit_id,service_id,name,path,form_type,price_mode,technical,status) select id,$2,'Color ficticio integral','Color de prueba','color','custom',ita_private.default_technical('color'),'draft' from ita_private.visits where client_id=$1",
    [client.id, color.id],
  );
  await db.query(
    "update ita_private.visit_services set status='void' where id=(select id from ita_private.visit_services where visit_id in(select id from ita_private.visits where client_id=$1) order by id limit 1)",
    [client.id],
  );
  await db.exec('set role authenticated');
  const manifest = await get({ scope: 'client', id: client.id, limit: 1 });
  check(manifest.timezone, 'America/Bogota', 'Export declares local interpretation of dates');
  check(
    manifest.data.tables.find((t) => t.name === 'visits').count,
    55,
    'Integral client export does not inherit the history page limit',
  );
  check(
    manifest.data.tables.find((t) => t.name === 'visit_services').count,
    55,
    'Export retains void and unvalued technical records',
  );
  check(
    manifest.data.tables.find((t) => t.name === 'clients').count,
    1,
    'Client export includes only its client row',
  );
  const records = [];
  for (let offset = 0; offset < 55; offset += 20) {
    const page = (
      await get({
        scope: 'client',
        id: client.id,
        revision: manifest.data.revision,
        table: 'visit_services',
        offset,
        limit: 20,
      })
    ).data;
    records.push(...page.items);
    check(
      page.next_offset,
      offset + page.items.length < 55 ? offset + page.items.length : null,
      'Page cursor represents exact remaining records',
    );
  }
  check(
    new Set(records.map((r) => r.id)).size,
    55,
    'Every service appears exactly once over multiple pages',
  );
  check(
    records.filter((r) => r.status === 'void').length,
    1,
    'Void record retained rather than silently omitted',
  );
  check(
    records.every((r) => r.price === null && r.technical.map.templateVersion === 1),
    true,
    'Pending COP and editable map versions survive integral export',
  );
  await denied(
    () => get({ scope: 'client', id: client.id, table: 'clients' }),
    /Inicia la exportación/,
  );
  await denied(
    () =>
      get({
        scope: 'client',
        id: client.id,
        table: 'auth.users',
        revision: manifest.data.revision,
      }),
    /no exportable/,
  );
  await denied(
    () =>
      get({
        scope: 'client',
        id: client.id,
        table: 'clients; drop schema public',
        revision: manifest.data.revision,
      }),
    /no exportable/,
  );
  const clientRow = (
    await get({
      scope: 'client',
      id: client.id,
      table: 'clients',
      revision: manifest.data.revision,
    })
  ).data.items[0];
  check(
    clientRow.notes,
    client.notes,
    'Free text is returned as JSON data without interpreting markup',
  );
  const global = (await get({ scope: 'global' })).data;
  check(
    global.tables.length,
    22,
    'Global export covers every business table and status, excluding the internal retry journal',
  );
  check(
    global.tables.some((t) => ['users', 'sessions', 'operations'].includes(t.name)),
    false,
    'No Auth credentials, sessions or retry payload journal in exports',
  );
  for (const table of global.tables) {
    const page = (
      await get({ scope: 'global', revision: global.revision, table: table.name, limit: 1 })
    ).data;
    check(page.total, table.count, `Manifest count agrees with ${table.name} page`);
  }
  const changed = await cmd('client.save', { ...client, notes: 'Cambio concurrente ficticio' });
  await denied(
    () =>
      get({ scope: 'client', id: client.id, revision: manifest.data.revision, table: 'visits' }),
    /cambiaron durante/,
  );
  await denied(() => get({ scope: 'global', revision: global.revision }), /cambiaron durante/);
  const newManifest = (await get({ scope: 'client', id: client.id })).data;
  check(
    (
      await get({
        scope: 'client',
        id: client.id,
        revision: newManifest.revision,
        table: 'clients',
      })
    ).data.items[0].version,
    changed.version,
    'A fresh export can resume after concurrent work',
  );
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [worker]);
  await db.exec('set role authenticated');
  for (const scope of ['global', 'client', 'clients', 'inventory', 'finance'])
    await denied(() => get({ scope, id: client.id }), /dueña/);
  await db.exec('reset role');
  return checks;
}
