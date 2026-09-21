import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createTestDatabase } from '../scripts/db-test.mjs';

const db = await createTestDatabase(process.argv.includes('--native'));
try {
  await db.exec('alter table auth.users add column email text');
  const people = [
    { id: randomUUID(), email: 'owner@ita.example', name: 'Dueña', role: 'owner' },
    { id: randomUUID(), email: 'worker@ita.example', name: 'Profesional', role: 'worker' },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: randomUUID(),
      email: `ita-pilot-${index}@example.invalid`,
      name: `[PRUEBA] perfil ${index}`,
      role: index % 2 ? 'worker' : 'owner',
    })),
  ];
  for (const person of people) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [person.id, person.email]);
    await db.query('insert into ita_private.profiles(id,display_name,role) values($1,$2,$3)', [
      person.id,
      person.name,
      person.role,
    ]);
  }
  for (let index = 0; index < 3; index++)
    await db.query('insert into ita_private.clients(name,consent,created_by) values($1,$2,$3)', [
      `Clienta ${index}`,
      'client-notice-v1',
      people[0].id,
    ]);
  await db.exec(
    "insert into ita_private.categories(kind,name) values('service','[PRUEBA] Servicio')",
  );
  await db.query('insert into ita_private.audit(actor_id,action) values($1,$2)', [
    people[2].id,
    'pilot',
  ]);

  const cleanup = await readFile('scripts/cleanup-pilot.sql', 'utf8');
  await assert.rejects(db.exec(cleanup), /Pilot or personal account counts changed/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from ita_private.clients')).rows[0].n, 3);

  await db.query('insert into ita_private.clients(name,consent,created_by) values($1,$2,$3)', [
    'Otra clienta',
    'client-notice-v1',
    people[0].id,
  ]);
  await db.exec(cleanup);
  assert.equal((await db.query('select count(*)::int as n from ita_private.clients')).rows[0].n, 0);
  assert.equal(
    (await db.query('select count(*)::int as n from ita_private.categories')).rows[0].n,
    0,
  );
  assert.equal((await db.query('select count(*)::int as n from ita_private.audit')).rows[0].n, 0);
  assert.equal(
    (await db.query('select count(*)::int as n from ita_private.profiles')).rows[0].n,
    2,
  );
  assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n, 2);
  assert.equal(
    (await db.query('select count(*)::int as n from ita_private.settings')).rows[0].n,
    1,
  );
  console.log('PILOT_CLEANUP_VERIFIED: guards, rollback, cleanup and personal accounts');
} finally {
  await db.close();
}
