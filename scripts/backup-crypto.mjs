import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, rm, stat, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

// Format v1: magic (8) | salt (32) | nonce (12) | ciphertext | GCM tag (16).
// Fixed KDF parameters prevent untrusted headers from requesting excessive work.
const MAGIC = Buffer.from('ITABKP01');
const HEADER_SIZE = 52;
export const MAX_PLAIN_BYTES = 2_000_000_000;
const keyFor = (password, salt) => {
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

export async function encryptFile(input, output, password) {
  if ((await stat(input)).size > MAX_PLAIN_BYTES) throw new Error('BACKUP_TOO_LARGE');
  const salt = randomBytes(32),
    nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, nonce]);
  const cipher = createCipheriv('aes-256-gcm', keyFor(password, salt), nonce);
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

export async function decryptFile(input, output, password, maximum = MAX_PLAIN_BYTES) {
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
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('INVALID_BACKUP');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(password, header.subarray(8, 40)),
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
