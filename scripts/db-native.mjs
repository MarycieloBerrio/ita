import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

/** Disposable local PostgreSQL only. Never accepts a remote URL or production database. */
export async function createNativeDatabase() {
  const config = { host: '127.0.0.1', port: 55433, user: 'ita_test', database: 'postgres' };
  const name = `ita_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Client(config);
  await admin.connect();
  await admin.query(`create database ${name}`);
  const client = new Client({ ...config, database: name });
  await client.connect();
  const sessions = [];
  return {
    name,
    engine: 'PostgreSQL 17 native',
    query: (...args) => client.query(...args),
    exec: (sql) => client.query(sql),
    async connect(user) {
      const session = new Client({ ...config, database: name });
      await session.connect();
      await session.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await session.query('set role authenticated');
      sessions.push(session);
      return session;
    },
    async close() {
      await Promise.all(sessions.map((s) => s.end()));
      await client.end();
      // name is generated here, never taken from user configuration or a live database.
      await admin.query(`drop database ${name}`);
      await admin.end();
    },
  };
}
