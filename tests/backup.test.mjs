// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decryptFile, encryptFile } from '../scripts/backup-crypto.mjs';
import { postgresEnv } from '../scripts/backup-common.mjs';
import { retentionPlan } from '../scripts/backup-retention.mjs';

const password = 'ficticia-solo-pruebas-no-es-clave-real-123456789';
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

describe('destino y cuota', () => {
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
