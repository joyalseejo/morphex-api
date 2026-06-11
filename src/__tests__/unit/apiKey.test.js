import { describe, it, expect } from '@jest/globals';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  getKeyPrefix,
} from '../../utils/apiKey.js';

describe('generateApiKey', () => {
  it('returns a string starting with mx_live_ by default', () => {
    expect(generateApiKey()).toMatch(/^mx_live_/);
  });

  it('returns mx_live_ when mode="live"', () => {
    expect(generateApiKey('live')).toMatch(/^mx_live_/);
  });

  it('returns mx_test_ when mode="test"', () => {
    expect(generateApiKey('test')).toMatch(/^mx_test_/);
  });

  it('returns a string of at least 40 characters', () => {
    expect(generateApiKey().length).toBeGreaterThanOrEqual(40);
  });

  it('returns a different value on each call', () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});

describe('hashApiKey', () => {
  it('is deterministic — same input always yields same hash', () => {
    const key = 'mx_live_testkey123';
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it('produces a 64-character hex string (SHA-256)', () => {
    expect(hashApiKey('mx_live_somekey')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different keys', () => {
    expect(hashApiKey('mx_live_aaa')).not.toBe(hashApiKey('mx_live_bbb'));
  });
});

describe('verifyApiKey', () => {
  it('returns true when the key matches its own hash', () => {
    const key = generateApiKey();
    expect(verifyApiKey(key, hashApiKey(key))).toBe(true);
  });

  it('returns false when given the wrong hash', () => {
    const key = generateApiKey();
    const wrongHash = hashApiKey('mx_live_totallyDifferentKey12345');
    expect(verifyApiKey(key, wrongHash)).toBe(false);
  });
});

describe('getKeyPrefix', () => {
  it('returns exactly the first 12 characters', () => {
    const key = 'mx_live_abcdefghijklmnop';
    expect(getKeyPrefix(key)).toBe('mx_live_abcd');
  });

  it('returned prefix has length 12', () => {
    expect(getKeyPrefix(generateApiKey()).length).toBe(12);
  });
});
