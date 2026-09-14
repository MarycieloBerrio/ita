// Runs only against the generated, disposable 127.0.0.1:55433 database.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createNativeDatabase } from '../scripts/db-native.mjs';
import { run, temporaryWork } from '../scripts/backup-common.mjs';
import { executeNativeDump } from '../scripts/backup-native.mjs';

const db = await createNativeDatabase();
try {
  await db.exec(
    'create schema auth; create table auth.users(id uuid primary key, encrypted_password text, label text); create table public.backup_probe(id integer primary key)',
  );
  await db.query(
    "insert into auth.users values('00000000-0000-4000-8000-000000000001','fictional-hash-only','Ficticia: Bogotá')",
  );
  await temporaryWork(async (directory) => {
    for (const data of [false, true]) {
      const script = await run(process.execPath, [
        'node_modules/supabase/dist/supabase.js',
        'db',
        'dump',
        '--db-url',
        `postgresql://ita_test:fixture_only@127.0.0.1:55433/${db.name}`,
        '--dry-run',
        '--schema',
        'auth,public',
        ...(data ? ['--data-only', '--use-copy'] : []),
      ]);
      assert.equal((script.match(/--role "postgres"/g) ?? []).length, 1);
      // This cluster's administrator is ita_test. Production executes the original CLI script.
      const localScript = script.replace('--role "postgres"', '--role "ita_test"');
      const output = join(directory, data ? 'data.sql' : 'schema.sql');
      await executeNativeDump(localScript, output);
      assert.ok((await stat(output)).size > 0);
      const sql = await readFile(output, 'utf8');
      if (data) assert.ok(sql.includes('Ficticia: Bogotá') && sql.includes('fictional-hash-only'));
      else
        assert.ok(
          sql.includes('CREATE TABLE') &&
            sql.includes('encrypted_password') &&
            sql.includes('backup_probe'),
        );
    }
  });
  console.log(
    'PASS: CLI dry-run → stdin Git Bash → pg_dump PostgreSQL local; esquema Auth y datos ficticios Unicode, sin guardar script/credenciales.',
  );
} finally {
  await db.close();
}
