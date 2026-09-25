// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { decryptFile, encryptFile, parseRecoveryKey } from '../scripts/backup-crypto.mjs';
import { EXCLUDED_DATA_TABLES, postgresEnv, safeErrorSummary } from '../scripts/backup-common.mjs';
import { SCHEDULED_DUMPS } from '../scripts/backup.mjs';
import { retentionPlan } from '../scripts/backup-retention.mjs';

// Fictional v2 key: base64 of 32 random bytes. Never a real recovery key.
const password = 'bpycnAu/dlnunST4xSqwdLSBZqb+LtlSp/Oi3pwH9/g=';
const legacyPassword = 'ficticia-solo-pruebas-no-es-clave-real-123456789';
const directories = [];
async function paths() {
  const dir = await mkdtemp(join(tmpdir(), 'ita-backup-test-'));
  directories.push(dir);
  return [join(dir, 'plain'), join(dir, 'encrypted'), join(dir, 'restored')];
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('respaldo cifrado', () => {
  it('recupera exactamente Unicode, saltos y datos binarios sin texto legible', async () => {
    const [plain, encrypted, restored] = await paths();
    const data = Buffer.concat([
      Buffer.from('Clienta ficticia, color café\n$230.000\n'),
      Buffer.from([0, 255, 3]),
    ]);
    await writeFile(plain, data);
    await encryptFile(plain, encrypted, password);
    expect((await readFile(encrypted)).includes(Buffer.from('Clienta ficticia'))).toBe(false);
    await decryptFile(encrypted, restored, password);
    expect(await readFile(restored)).toEqual(data);
  });
  it.each(['password', 'ciphertext', 'header', 'tag', 'truncated'])(
    'rechaza alteración %s y elimina salida incompleta',
    async (kind) => {
      const [plain, encrypted, restored] = await paths();
      await writeFile(plain, 'información ficticia'.repeat(50));
      await encryptFile(plain, encrypted, password);
      const data = await readFile(encrypted);
      if (kind === 'ciphertext') data[58] ^= 1;
      if (kind === 'header') data[12] ^= 1;
      if (kind === 'tag') data[data.length - 1] ^= 1;
      await writeFile(encrypted, kind === 'truncated' ? data.subarray(0, 25) : data);
      await expect(
        decryptFile(encrypted, restored, kind === 'password' ? password + 'bad' : password),
      ).rejects.toThrow();
      await expect(stat(restored)).rejects.toThrow();
    },
  );
  it('exige clave base64 de 32 bytes aleatorios y rechaza frases o patrones', async () => {
    expect(parseRecoveryKey(password)).toHaveLength(32);
    expect(parseRecoveryKey(randomBytes(32).toString('base64url'))).toHaveLength(32);
    for (const weak of [
      legacyPassword,
      'x'.repeat(64),
      Buffer.alloc(32).toString('base64'),
      Buffer.alloc(32, 'ab').toString('base64'),
      randomBytes(31).toString('base64'),
      randomBytes(33).toString('base64'),
      undefined,
    ])
      expect(() => parseRecoveryKey(weak)).toThrow(/RECOVERY_KEY/);
    const [plain, encrypted] = await paths();
    await writeFile(plain, 'dato');
    await expect(encryptFile(plain, encrypted, legacyPassword)).rejects.toThrow(/RECOVERY_KEY/);
  });
  it('descifra copias v1 existentes (frase + scrypt) y escribe siempre v2', async () => {
    const [plain, encrypted, restored] = await paths();
    const data = Buffer.from('copia heredada ficticia');
    const salt = randomBytes(32),
      nonce = randomBytes(12);
    const header = Buffer.concat([Buffer.from('ITABKP01'), salt, nonce]);
    const key = scryptSync(legacyPassword, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 << 20 });
    const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(header);
    const body = Buffer.concat([cipher.update(gzipSync(data)), cipher.final()]);
    await writeFile(encrypted, Buffer.concat([header, body, cipher.getAuthTag()]));
    await decryptFile(encrypted, restored, legacyPassword);
    expect(await readFile(restored)).toEqual(data);
    await rm(encrypted);
    await writeFile(plain, data);
    await encryptFile(plain, encrypted, password);
    expect((await readFile(encrypted)).subarray(0, 8).toString()).toBe('ITABKP02');
  });
  it('no sobrescribe ni borra archivos previos y limita descompresión', async () => {
    const [plain, encrypted, restored] = await paths();
    await writeFile(plain, 'x'.repeat(1024));
    await encryptFile(plain, encrypted, password);
    await writeFile(restored, 'conservar');
    await expect(decryptFile(encrypted, restored, password)).rejects.toThrow();
    expect(await readFile(restored, 'utf8')).toBe('conservar');
    await rm(restored);
    await expect(decryptFile(encrypted, restored, password, 20)).rejects.toThrow();
    await expect(stat(restored)).rejects.toThrow();
  });
});

describe('alcance y diagnóstico', () => {
  it('excluye sesiones y tokens Auth pero conserva identidades', () => {
    const data = SCHEDULED_DUMPS.find(([name]) => name === 'data.sql');
    for (const table of ['auth.sessions', 'auth.refresh_tokens', 'auth.one_time_tokens'])
      expect(data).toContain(table);
    expect(EXCLUDED_DATA_TABLES).not.toContain('auth.users');
    expect(EXCLUDED_DATA_TABLES).not.toContain('auth.identities');
  });
  it('resume errores sin mensajes de herramientas', () => {
    expect(safeErrorSummary(new Error('BACKUP_TOOL_FAILED_PSQL_2'), 'create')).toBe(
      'step=create code=BACKUP_TOOL_FAILED_PSQL_2 system=- type=Error',
    );
    const leaked = safeErrorSummary(
      new Error('connection to postgresql://postgres:secreto@db.example/postgres failed'),
      'create',
    );
    expect(leaked).not.toContain('secreto');
    expect(leaked).toContain('code=UNCLASSIFIED');
  });
});

describe('destino y cuota', () => {
  it('exige verificación TLS con CA para bases remotas', () => {
    const remote = 'postgresql://postgres:x@db.mrnzvgivfjivuobpgens.supabase.co:5432/postgres';
    const previous = { ...process.env };
    try {
      delete process.env.ITA_PG_SSLROOTCERT;
      delete process.env.ITA_PG_ALLOW_UNVERIFIED_TLS;
      expect(() => postgresEnv(remote)).toThrow('TLS_CA_REQUIRED_FOR_REMOTE_DATABASE');
      process.env.ITA_PG_SSLROOTCERT = join(tmpdir(), 'ita-no-such-ca.crt');
      expect(() => postgresEnv(remote)).toThrow('TLS_CA_FILE_NOT_FOUND');
      process.env.ITA_PG_SSLROOTCERT = process.execPath; // Any existing absolute file.
      expect(postgresEnv(remote)).toMatchObject({
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: process.execPath,
      });
      delete process.env.ITA_PG_SSLROOTCERT;
      process.env.ITA_PG_ALLOW_UNVERIFIED_TLS = 'true';
      expect(postgresEnv(remote).PGSSLMODE).toBe('require');
      expect(postgresEnv('postgresql://u:p@127.0.0.1:55433/postgres').PGSSLMODE).toBe('disable');
    } finally {
      process.env = previous;
    }
  });
  it('rechaza producción, otro nombre y bases administrativas', () => {
    for (const url of [
      'postgresql://postgres@db.mrnzvgivfjivuobpgens.supabase.co/postgres',
      'postgresql://postgres@127.0.0.1/postgres',
      'postgresql://postgres@127.0.0.1/ita_restore_other',
    ])
      expect(() =>
        postgresEnv(url, { localOnly: true, expectedDatabase: 'ita_restore_test' }),
      ).toThrow();
    expect(
      postgresEnv('postgresql://postgres@127.0.0.1:55433/ita_restore_test', {
        localOnly: true,
        expectedDatabase: 'ita_restore_test',
      }).PGDATABASE,
    ).toBe('ita_restore_test');
  });
  const artifact = (i, bytes = 10_000_000) => ({
    id: i,
    name: `ita-backup-202609${String(i).padStart(2, '0')}-1-1`,
    created_at: `2026-09-${String(i).padStart(2, '0')}T08:23:00Z`,
    size_in_bytes: bytes,
    expired: false,
  });
  it('conserva hasta siete copias incluyendo nueva y protege última existente', () => {
    const plan = retentionPlan(
      Array.from({ length: 7 }, (_, i) => artifact(i + 1)),
      10_000_000,
      350_000_000,
      0,
    );
    expect(plan.remove.map((a) => a.id)).toEqual([1]);
    expect(plan.projectedCopies).toBe(7);
    expect(() => retentionPlan([artifact(1, 340_000_000)], 20_000_000, 350_000_000)).toThrow();
  });
  it('considera artefactos ajenos y cuota externa sin borrarlos', () => {
    const other = { ...artifact(3), name: 'build', size_in_bytes: 280_000_000 };
    const plan = retentionPlan(
      [artifact(1), artifact(2), other],
      10_000_000,
      350_000_000,
      40_000_000,
    );
    expect(plan.remove.map((a) => a.id)).toEqual([1]);
    expect(() => retentionPlan([], 20_000_000, 500_000_000)).toThrow();
    expect(() => retentionPlan([], 20_000_000, 350_000_000, 340_000_000)).toThrow();
  });
});
