// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { executeNativeDump, NATIVE_DUMPS, validateNativeDump } from '../scripts/backup-native.mjs';

const script = `#!/usr/bin/env bash
set -euo pipefail
export PGHOST="127.0.0.1"
export PGPORT="55433"
export PGUSER="ita_test"
export PGPASSWORD="fictional-secret"
export PGDATABASE="postgres"
pg_dump --schema-only --quote-all-identifier
`;

describe('native backup execution boundary', () => {
  it('accepts a CLI dump and refuses incomplete credentials or ordinary command output', () => {
    expect(() => validateNativeDump(script)).not.toThrow();
    expect(() => validateNativeDump(script.replace('export PGPASSWORD', '# PGPASSWORD'))).toThrow(
      'UNEXPECTED_CLI_DUMP_SCRIPT',
    );
    expect(() => validateNativeDump('CLI access denied')).toThrow('UNEXPECTED_CLI_DUMP_SCRIPT');
  });

  it('passes generated credentials only through stdin and does not forward administrative environment', async () => {
    let call;
    await executeNativeDump(script, '/temporary/schema.sql', {
      env: {
        ITA_BASH_BIN: '/bin/bash',
        ITA_PG_BIN: '/pg/bin',
        PATH: '/bin',
        SUPABASE_ACCESS_TOKEN: 'private-token',
        ITA_BACKUP_RECOVERY_KEY: 'private-recovery',
        ITA_BACKUP_DATABASE_URL: 'private-url',
      },
      execute: async (...args) => {
        call = args;
      },
    });
    expect(call[1]).toEqual(['--noprofile', '--norc', '-s']);
    expect(JSON.stringify(call.slice(0, 2))).not.toContain('fictional-secret');
    expect(call[2].input).toBe(script.replace('--quote-all-identifier', '--quote-all-identifiers'));
    expect(Object.keys(call[2].env)).toEqual([
      'PATH',
      'PGSSLMODE',
      'PGCONNECT_TIMEOUT',
      'PGOPTIONS',
    ]);
    expect(call[2].env.PGSSLMODE).toBe('disable');
    expect(JSON.stringify(call[2].env)).not.toContain('private-');
  });

  it('requires explicit native tools before running any program', async () => {
    await expect(executeNativeDump(script, 'unused', { env: {} })).rejects.toThrow(
      'NATIVE_BACKUP_TOOLS_REQUIRED',
    );
  });

  it('requires encrypted PostgreSQL transport for a hosted source', async () => {
    let settings;
    await executeNativeDump(script.replace('127.0.0.1', 'db.example.supabase.co'), 'unused', {
      env: { ITA_BASH_BIN: '/bin/bash', ITA_PG_BIN: '/pg/bin' },
      execute: async (_command, _args, options) => {
        settings = options.env;
      },
    });
    expect(settings.PGSSLMODE).toBe('require');
  });

  it('includes actual Auth schema and data and migration history in separate dumps', () => {
    expect(NATIVE_DUMPS.find(([name]) => name === 'schema.sql')).toEqual([
      'schema.sql',
      '--schema',
      'auth,public,ita_private',
    ]);
    expect(NATIVE_DUMPS.find(([name]) => name === 'data.sql')).toContain('--use-copy');
    expect(NATIVE_DUMPS.find(([name]) => name === 'history_data.sql')).toContain(
      'supabase_migrations',
    );
  });
});
