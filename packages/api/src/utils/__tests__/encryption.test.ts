import { decrypt, encrypt } from '@/utils/encryption';

// 32 bytes as hex (64 chars).
const KEY = 'a'.repeat(64);

describe('encryption', () => {
  const original = process.env.HDX_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.HDX_ENCRYPTION_KEY = KEY;
  });
  afterAll(() => {
    process.env.HDX_ENCRYPTION_KEY = original;
  });

  it('round-trips plaintext and never leaks it in the ciphertext', () => {
    const secret = 'sk-ant-api03-supersecret';
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(decrypt(enc)).toBe(secret);
  });

  it('uses a random IV so identical plaintext encrypts differently', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const [iv, tag] = encrypt('secret').split(':');
    const tampered = [iv, tag, Buffer.from('tampered').toString('base64')].join(
      ':',
    );
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws a clear error when the key is missing', () => {
    delete process.env.HDX_ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/HDX_ENCRYPTION_KEY/);
  });

  it('throws when the key does not decode to 32 bytes', () => {
    process.env.HDX_ENCRYPTION_KEY = 'too-short';
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });
});
