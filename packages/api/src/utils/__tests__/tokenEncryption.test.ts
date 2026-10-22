import crypto from 'crypto';

import logger from '@/utils/logger';
import {
  createAesGcmProvider,
  decryptToken,
  encryptToken,
  isTokenEnvelope,
  parseEncryptionKey,
  registerTokenEncryptionProvider,
  selectDefaultProvider,
  setActiveTokenEncryptionProvider,
  TokenEncryptionProvider,
  verifyTokenEncryption,
} from '@/utils/tokenEncryption';

const KEY = crypto.randomBytes(32);
const OTHER_KEY = crypto.randomBytes(32);

// Registered once: re-registering a name is itself a warned-about event, and
// the suite asserts on that warning below.
beforeAll(() => {
  registerTokenEncryptionProvider(createAesGcmProvider('test-aes', () => KEY));
  registerTokenEncryptionProvider(
    createAesGcmProvider('test-aes-twin', () => KEY),
  );
  registerTokenEncryptionProvider(
    createAesGcmProvider('test-aes-other', () => OTHER_KEY),
  );
  registerTokenEncryptionProvider({
    name: 'broken',
    encrypt: async () => {
      throw new Error('KMS unreachable');
    },
    decrypt: async () => {
      throw new Error('KMS unreachable');
    },
  });
});

describe('tokenEncryption', () => {
  beforeEach(() => {
    setActiveTokenEncryptionProvider('test-aes');
  });

  describe('encryptToken / decryptToken', () => {
    it('encrypts and decrypts a token', async () => {
      const token = 'test-bot-token-0123456789';

      await expect(decryptToken(await encryptToken(token))).resolves.toBe(
        token,
      );
    });

    it('encrypts and decrypts an empty token', async () => {
      await expect(decryptToken(await encryptToken(''))).resolves.toBe('');
    });

    it('tags the envelope with the version and provider, and hides the plaintext', async () => {
      const envelope = await encryptToken('xoxb-secret');

      expect(envelope.startsWith('v1:test-aes:')).toBe(true);
      expect(envelope).not.toContain('xoxb-secret');
    });

    it('produces a different ciphertext each time', async () => {
      const [a, b] = await Promise.all([
        encryptToken('same-token'),
        encryptToken('same-token'),
      ]);

      expect(a).not.toBe(b);
    });

    it('rejects a tampered ciphertext', async () => {
      const envelope = await encryptToken('xoxb-secret');
      const payload = Buffer.from(envelope.split(':')[2], 'base64');
      payload[payload.length - 1] ^= 0xff;

      await expect(
        decryptToken(`v1:test-aes:${payload.toString('base64')}`),
      ).rejects.toThrow();
    });

    it('rejects a ciphertext encrypted under a different key', async () => {
      const envelope = await encryptToken('xoxb-secret');
      const relabelled = envelope.replace('v1:test-aes:', 'v1:test-aes-other:');

      await expect(decryptToken(relabelled)).rejects.toThrow();
    });

    it('rejects a payload replayed under a different provider sharing the key', async () => {
      const envelope = await encryptToken('xoxb-secret');
      const relabelled = envelope.replace('v1:test-aes:', 'v1:test-aes-twin:');

      await expect(decryptToken(relabelled)).rejects.toThrow();
    });

    it('decrypts with the provider named in the envelope, not the active one', async () => {
      const envelope = await encryptToken('written-by-test-aes');
      setActiveTokenEncryptionProvider('test-aes-other');

      await expect(decryptToken(envelope)).resolves.toBe('written-by-test-aes');
      expect(await encryptToken('x')).toContain(':test-aes-other:');
    });

    it('refuses to encrypt a value that is already an envelope', async () => {
      const envelope = await encryptToken('xoxb-secret');

      await expect(encryptToken(envelope)).rejects.toThrow(/already/);
    });

    it('throws when the envelope names an unregistered provider', async () => {
      await expect(decryptToken('v1:kms:abcd')).rejects.toThrow(/kms/);
    });

    it('throws on an unsupported envelope version', async () => {
      await expect(decryptToken('v2:test-aes:abcd')).rejects.toThrow(/v2/);
    });

    it('throws on a payload too short to hold an IV and tag', async () => {
      const short = crypto.randomBytes(8).toString('base64');

      await expect(decryptToken(`v1:test-aes:${short}`)).rejects.toThrow();
    });

    it('rejects a raw token without putting it in the error message', async () => {
      const raw = 'test-bot-token-0123456789';

      let message = '';
      try {
        await decryptToken(raw);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }

      expect(message).toMatch(/not a token encryption envelope/);
      expect(message).not.toContain(raw);
    });
  });

  describe('provider registry', () => {
    it('rejects a provider name that would break the envelope prefix', () => {
      const provider: TokenEncryptionProvider = {
        name: 'kms:aws',
        encrypt: async token => token,
        decrypt: async payload => payload,
      };

      expect(() => registerTokenEncryptionProvider(provider)).toThrow(
        /kms:aws/,
      );
    });

    it('refuses to activate an unregistered provider', () => {
      expect(() => setActiveTokenEncryptionProvider('nope')).toThrow(/nope/);
    });

    it('warns when a provider name is re-registered', () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      registerTokenEncryptionProvider(
        createAesGcmProvider('test-dup', () => KEY),
      );
      registerTokenEncryptionProvider(
        createAesGcmProvider('test-dup', () => OTHER_KEY),
      );

      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });

  describe('the none provider', () => {
    it('leaves the token readable in the envelope', async () => {
      setActiveTokenEncryptionProvider('none');

      expect(await encryptToken('xoxb-secret')).toBe('v1:none:xoxb-secret');
    });

    it('handles a token containing a colon', async () => {
      setActiveTokenEncryptionProvider('none');

      await expect(decryptToken(await encryptToken('a:b:c'))).resolves.toBe(
        'a:b:c',
      );
    });

    it('still reads plain-text rows once encryption is on, and warns', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      await expect(
        decryptToken('v1:none:written-while-disabled'),
      ).resolves.toBe('written-while-disabled');
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
      expect(await encryptToken('x')).toContain(':test-aes:');
    });
  });

  describe('isTokenEnvelope', () => {
    it('recognises an envelope and rejects a bare token', () => {
      expect(isTokenEnvelope('v1:none:xoxb-secret')).toBe(true);
      expect(isTokenEnvelope('v2:kms:abcd')).toBe(true);
      expect(isTokenEnvelope('xoxb-1234567890')).toBe(false);
      expect(isTokenEnvelope('a:b:c')).toBe(false);
    });
  });

  describe('selectDefaultProvider', () => {
    it('stores tokens in plain text when no key is configured', () => {
      expect(selectDefaultProvider(undefined)).toBe('none');
      expect(selectDefaultProvider('')).toBe('none');
    });

    it('encrypts when a key is configured', () => {
      expect(selectDefaultProvider(KEY.toString('base64'))).toBe('local');
    });
  });

  describe('parseEncryptionKey', () => {
    it('accepts a base64 32-byte key', () => {
      expect(parseEncryptionKey(KEY.toString('base64'))).toEqual(KEY);
    });

    it('accepts a hex 32-byte key', () => {
      expect(parseEncryptionKey(KEY.toString('hex'))).toEqual(KEY);
    });

    it('tolerates surrounding whitespace from a piped secret', () => {
      expect(parseEncryptionKey(`  ${KEY.toString('hex')}\n`)).toEqual(KEY);
      expect(parseEncryptionKey(`${KEY.toString('base64')}\n`)).toEqual(KEY);
    });

    it('throws when unset', () => {
      expect(() => parseEncryptionKey(undefined)).toThrow(
        /TOKEN_ENCRYPTION_KEY/,
      );
    });

    it('rejects a key that is not valid base64 or hex', () => {
      // Decodes to 32 bytes only because the base64 decoder skips the quotes.
      const quoted = `"${KEY.toString('base64')}"`;

      expect(() => parseEncryptionKey(quoted)).toThrow(/standard base64/);
    });

    it('throws on a key of the wrong length without echoing it', () => {
      const shortKey = crypto.randomBytes(16).toString('base64');

      expect(() => parseEncryptionKey(shortKey)).toThrow(/32 bytes/);

      let message = '';
      try {
        parseEncryptionKey(shortKey);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).not.toContain(shortKey);
    });
  });

  describe('verifyTokenEncryption', () => {
    it('does not throw when the active provider is broken', async () => {
      setActiveTokenEncryptionProvider('broken');

      await expect(verifyTokenEncryption()).resolves.toBeUndefined();
    });

    it('passes with a working provider', async () => {
      await expect(verifyTokenEncryption()).resolves.toBeUndefined();
    });

    it('warns instead of verifying when encryption is disabled', async () => {
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      setActiveTokenEncryptionProvider('none');

      await expect(verifyTokenEncryption()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Token encryption is disabled'),
      );

      warn.mockRestore();
    });
  });
});
