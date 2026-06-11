import crypto from 'crypto';

const RANDOM_BYTES = 24; // 24 bytes → 32 base64url chars

const PREFIXES = {
  live: 'mx_live_',
  test: 'mx_test_',
};

export function generateApiKey(mode = 'live') {
  const prefix = PREFIXES[mode] ?? PREFIXES.live;
  const random = crypto.randomBytes(RANDOM_BYTES).toString('base64url');
  return `${prefix}${random}`;
}

export function getKeyType(key) {
  return key.startsWith('mx_test_') ? 'test' : 'live';
}

export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function getKeyPrefix(rawKey) {
  return rawKey.slice(0, 12);
}

export function verifyApiKey(rawKey, storedHash) {
  const hash = hashApiKey(rawKey);
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}
