import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, rm, stat, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

// Common layout: magic (8) | salt (32) | nonce (12) | ciphertext | GCM tag (16).
// The whole header is authenticated as AAD.
// v2 (ITABKP02, written): the recovery key is base64 of exactly 32 random bytes; the AES key is
//   HKDF-SHA256(key, salt, info). Only high-entropy keys are accepted, so no password KDF is needed.
// v1 (ITABKP01, read-only): legacy passphrase of >= 32 bytes stretched with fixed scrypt parameters.
// Fixed KDF parameters prevent untrusted headers from requesting excessive work.
const MAGIC_V1 = Buffer.from('ITABKP01');
const MAGIC_V2 = Buffer.from('ITABKP02');
const HKDF_INFO = Buffer.from('ita-backup v2 aes-256-gcm');
const HEADER_SIZE = 52;
export const MAX_PLAIN_BYTES = 2_000_000_000;
export const KEY_GENERATION_COMMAND =
  "node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\"";

/**
 * Parses a v2 recovery key: canonical base64 (standard with padding, or base64url without) that
 * decodes to exactly 32 bytes. Rejects passphrases and visibly degenerate byte patterns.
 */
export function parseRecoveryKey(value) {
  if (typeof value !== 'string') throw new Error('RECOVERY_KEY_REQUIRED_BASE64_32_BYTES');
  const text = value.trim();
  const standard = /^[A-Za-z0-9+/]{43}=$/.test(text);
  const url = /^[A-Za-z0-9_-]{43}$/.test(text);
  if (!standard && !url) throw new Error('RECOVERY_KEY_REQUIRED_BASE64_32_BYTES');
  const key = Buffer.from(text, standard ? 'base64' : 'base64url');
  if (key.length !== 32 || key.toString(standard ? 'base64' : 'base64url') !== text)
    throw new Error('RECOVERY_KEY_REQUIRED_BASE64_32_BYTES');
  // 32 random bytes almost surely contain > 20 distinct values; this rejects "AAAA…"-style keys.
  if (new Set(key).size < 16) throw new Error('RECOVERY_KEY_LOW_ENTROPY');
  return key;
}

const keyV2 = (recoveryKey, salt) =>
  Buffer.from(hkdfSync('sha256', parseRecoveryKey(recoveryKey), salt, HKDF_INFO, 32));
const keyV1 = (password, salt) => {
  if (typeof password !== 'string' || Buffer.byteLength(password) < 32)
    throw new Error('RECOVERY_KEY_REQUIRED_32_BYTES');
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
};
const sizeLimit = (maximum) => {
  let bytes = 0;
  return new Transform({
    transform(chunk, encoding, done) {
      bytes += chunk.length;
      done(bytes > maximum ? new Error('BACKUP_TOO_LARGE') : null, chunk);
    },
  });
};

export async function encryptFile(input, output, recoveryKey) {
  if ((await stat(input)).size > MAX_PLAIN_BYTES) throw new Error('BACKUP_TOO_LARGE');
  const salt = randomBytes(32),
    nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC_V2, salt, nonce]);
  const cipher = createCipheriv('aes-256-gcm', keyV2(recoveryKey, salt), nonce);
  cipher.setAAD(header);
  await writeFile(output, header, { flag: 'wx', mode: 0o600 });
  try {
    await pipeline(
      createReadStream(input),
      createGzip({ level: 6 }),
      cipher,
      createWriteStream(output, { flags: 'a', mode: 0o600 }),
    );
    await appendFile(output, cipher.getAuthTag());
  } catch {
    await rm(output, { force: true });
    throw new Error('BACKUP_ENCRYPTION_FAILED');
  }
}

export async function decryptFile(input, output, recoveryKey, maximum = MAX_PLAIN_BYTES) {
  const size = (await stat(input)).size;
  if (size < HEADER_SIZE + 16 || size > MAX_PLAIN_BYTES) throw new Error('INVALID_BACKUP');
  const handle = await open(input, 'r');
  const header = Buffer.alloc(HEADER_SIZE),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, HEADER_SIZE, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  const magic = header.subarray(0, 8);
  const derive = magic.equals(MAGIC_V2) ? keyV2 : magic.equals(MAGIC_V1) ? keyV1 : null;
  if (!derive) throw new Error('INVALID_BACKUP');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derive(recoveryKey, header.subarray(8, 40)),
    header.subarray(40),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  // Reserve the output first: never remove a pre-existing file on failure.
  await writeFile(output, '', { flag: 'wx', mode: 0o600 });
  try {
    await pipeline(
      createReadStream(input, { start: HEADER_SIZE, end: size - 17 }),
      decipher,
      createGunzip(),
      sizeLimit(maximum),
      createWriteStream(output, { flags: 'a', mode: 0o600 }),
    );
  } catch {
    await rm(output, { force: true });
    throw new Error('BACKUP_AUTHENTICATION_OR_DECOMPRESSION_FAILED');
  }
}
