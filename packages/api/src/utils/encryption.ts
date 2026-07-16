import crypto from 'crypto';

// Symmetric encryption for secrets stored at rest. AES-256-GCM provides
// confidentiality plus an auth tag that detects tampering on decrypt. The
// 32-byte key comes from HDX_ENCRYPTION_KEY, read at use time (not module load)
// so misconfiguration surfaces a clear error and tests can control it.
//
// NOTE: OSS does not currently call this — the managed-agent key is read from
// the environment (see anthropicAgents.getTeamAnthropicKey), not stored
// encrypted. It is retained as infrastructure for downstream distributions
// (hyperdx-ee) that store per-team secrets encrypted at rest and inject the key
// via the `resolveAnthropicKey` extension seam. Exercised by its unit test.
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const getKey = (): Buffer => {
  const raw = process.env.HDX_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'HDX_ENCRYPTION_KEY is not set; it is required to encrypt secrets at rest',
    );
  }
  // Accept a 32-byte key as hex (64 chars) or base64.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'HDX_ENCRYPTION_KEY must decode to 32 bytes (256-bit) as hex or base64',
    );
  }
  return key;
};

// Returns "<iv>:<authTag>:<ciphertext>" (each base64).
export const encrypt = (plaintext: string): string => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
};

export const decrypt = (payload: string): string => {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
