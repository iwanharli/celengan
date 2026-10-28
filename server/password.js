import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

// Format tersimpan: "<salt hex>:<hash hex>"
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, keyHex = ''] = String(stored).split(':');
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  // Hash tersimpan yang rusak/tidak lengkap dianggap password salah, bukan error server.
  return expected.length === key.length && timingSafeEqual(key, expected);
}

export const MIN_PASSWORD_LENGTH = 8;
