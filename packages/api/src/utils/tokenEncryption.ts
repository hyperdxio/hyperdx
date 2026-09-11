import crypto from 'crypto';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { getCounter, withOperationMetrics } from '@/utils/instrumentation';
import logger from '@/utils/logger';

/**
 * Encryption at rest for third-party credentials we store and replay (Slack
 * bot tokens, OAuth access/refresh tokens).
 *
 * Stored values are `v1:<provider>:<payload>`. Decryption dispatches on the
 * provider named in the envelope rather than the active one, so switching
 * providers leaves rows written by the previous one readable. Tokens are
 * stored verbatim unless `TOKEN_ENCRYPTION_KEY` is set.
 *
 * Known limitation: the envelope carries no key id, so rotating
 * `TOKEN_ENCRYPTION_KEY` makes existing rows unreadable. Adding one is what
 * the version field is for.
 */

const ENVELOPE_VERSION = 'v1';
const LOCAL_PROVIDER = 'local';
const NONE_PROVIDER = 'none';
const PROVIDER_NAME_PATTERN = /^[a-z0-9-]+$/;
const ENVELOPE_PATTERN = /^v\d+:[a-z0-9-]+:/;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERIFY_TIMEOUT_MS = 10_000;
const VERIFY_SENTINEL = 'hyperdx-token-encryption-check';

export type BuiltInProviderName = typeof LOCAL_PROVIDER | typeof NONE_PROVIDER;

export interface TokenEncryptionProvider {
  readonly name: string;
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
}

const plaintextReadCounter = getCounter(
  'hyperdx.token_encryption.plaintext_reads',
  {
    description:
      'Count of stored tokens read back unencrypted while an encrypting provider was active.',
  },
);
const disabledCounter = getCounter('hyperdx.token_encryption.disabled', {
  description:
    'Incremented at startup when token encryption is turned off, so the state is alertable.',
});

const providers = new Map<string, TokenEncryptionProvider>();
let activeProviderName: string = NONE_PROVIDER;

export function registerTokenEncryptionProvider(
  provider: TokenEncryptionProvider,
): void {
  if (!PROVIDER_NAME_PATTERN.test(provider.name)) {
    throw new Error(
      `Invalid token encryption provider name "${provider.name}": must match ${PROVIDER_NAME_PATTERN}`,
    );
  }
  if (providers.has(provider.name)) {
    logger.warn(
      { provider: provider.name },
      'Token encryption provider replaced; envelopes written by the previous one may no longer decrypt',
    );
  }
  providers.set(provider.name, provider);
}

/** Selects the provider `encryptToken` writes with. Decryption is unaffected. */
export function setActiveTokenEncryptionProvider(name: string): void {
  if (!providers.has(name)) {
    throw new Error(
      `Cannot activate unregistered token encryption provider "${name}"; registered: ${[...providers.keys()].join(', ')}`,
    );
  }
  activeProviderName = name;
}

function getProvider(name: string): TokenEncryptionProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `Unknown token encryption provider "${name}"; registered: ${[...providers.keys()].join(', ')}`,
    );
  }
  return provider;
}

export function isTokenEnvelope(value: string): boolean {
  return ENVELOPE_PATTERN.test(value);
}

export async function encryptToken(plaintext: string): Promise<string> {
  // A re-encrypted envelope cannot be read back, and read-modify-write is the
  // easy way for a caller to get there.
  if (isTokenEnvelope(plaintext)) {
    throw new Error('Value is already a token encryption envelope');
  }
  const provider = getProvider(activeProviderName);
  return `${ENVELOPE_VERSION}:${provider.name}:${await provider.encrypt(plaintext)}`;
}

export async function decryptToken(envelope: string): Promise<string> {
  // Checked before any part of the input is interpolated into an error: a
  // caller passing a raw token would otherwise put the secret into the logs.
  if (!isTokenEnvelope(envelope)) {
    throw new Error('Value is not a token encryption envelope');
  }
  const [version, name, ...payload] = envelope.split(':');
  if (version !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported token envelope version "${version}"`);
  }
  if (name === NONE_PROVIDER && activeProviderName !== NONE_PROVIDER) {
    plaintextReadCounter.add(1);
    logger.warn(
      'Read a token stored without encryption; re-save it to encrypt at rest',
    );
  }
  return getProvider(name).decrypt(payload.join(':'));
}

/** Accepts base64 or hex. Errors never include the key, since they are logged. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set; generate one with `openssl rand -base64 32`',
    );
  }
  const isHex = /^[0-9a-f]{64}$/i.test(value);
  const key = Buffer.from(value, isHex ? 'hex' : 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  // Buffer's base64 decoder skips characters outside the alphabet, so a
  // mistyped key can still decode to the right length as the wrong key.
  const canonical = key.toString('base64').replace(/=+$/, '');
  if (!isHex && canonical !== value.replace(/=+$/, '')) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be standard base64 or 64 hex characters',
    );
  }
  return key;
}

/**
 * Payload layout is `iv || tag || ciphertext`, with the envelope prefix bound
 * as additional authenticated data so a payload cannot be replayed under a
 * different provider name. The key is resolved per call so a missing or
 * malformed key fails when a token is stored, not at import time.
 */
export function createAesGcmProvider(
  name: string,
  getKey: () => Buffer,
): TokenEncryptionProvider {
  const aad = Buffer.from(`${ENVELOPE_VERSION}:${name}`, 'utf8');
  return {
    name,
    async encrypt(plaintext) {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
        'base64',
      );
    },
    async decrypt(payload) {
      const buffer = Buffer.from(payload, 'base64');
      if (buffer.length < IV_BYTES + TAG_BYTES) {
        throw new Error('Encrypted token payload is truncated');
      }
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getKey(),
        buffer.subarray(0, IV_BYTES),
      );
      decipher.setAAD(aad);
      decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

let localKey: Buffer | undefined;
const getLocalKey = () =>
  (localKey ??= parseEncryptionKey(config.TOKEN_ENCRYPTION_KEY));

registerTokenEncryptionProvider(
  createAesGcmProvider(LOCAL_PROVIDER, getLocalKey),
);

/**
 * Stores tokens verbatim, for self-hosted deployments that would rather not
 * manage a key. The payload is left as plain text so that `v1:none:xoxb-…` in
 * the database is obviously unencrypted to anyone auditing it.
 *
 * Stays registered even when another provider is active, since that is what
 * keeps rows written while encryption was off readable afterwards.
 */
registerTokenEncryptionProvider({
  name: NONE_PROVIDER,
  encrypt: async plaintext => plaintext,
  decrypt: async payload => payload,
});

/**
 * Having a key is the whole opt-in: no key means no encryption. Deployments
 * that must encrypt (EE, cloud) activate their own provider in code rather
 * than depending on an env var being present.
 */
export function selectDefaultProvider(
  key: string | undefined,
): BuiltInProviderName {
  return key ? LOCAL_PROVIDER : NONE_PROVIDER;
}

setActiveTokenEncryptionProvider(
  selectDefaultProvider(config.TOKEN_ENCRYPTION_KEY),
);

/**
 * Encrypts and decrypts a fixed string at boot so a misconfigured key, KMS
 * key policy, or region shows up in deploy logs instead of at the first
 * OAuth install.
 *
 * A key that cannot be parsed throws, because that is an operator error the
 * process should not start with. Everything else logs and continues: the
 * process can still serve every request unrelated to stored tokens.
 *
 * Note this proves the active provider works, not that it can read rows
 * written earlier — a key swapped since the last deploy still verifies.
 */
export async function verifyTokenEncryption(): Promise<void> {
  if (activeProviderName === NONE_PROVIDER) {
    disabledCounter.add(1);
    logger.warn(
      'Token encryption is disabled: third-party tokens will be stored in plain text (set TOKEN_ENCRYPTION_KEY to enable)',
    );
    return;
  }
  if (activeProviderName === LOCAL_PROVIDER) {
    getLocalKey();
  }
  try {
    await withOperationMetrics('token_encryption.verify', async () => {
      // Bounded so a provider that makes network calls cannot hold up the boot
      // sequence. unref() keeps a pending timer from holding the process open.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Encryption check timed out after ${VERIFY_TIMEOUT_MS}ms`,
              ),
            ),
          VERIFY_TIMEOUT_MS,
        ).unref(),
      );
      const decrypted = await Promise.race([
        encryptToken(VERIFY_SENTINEL).then(decryptToken),
        timeout,
      ]);
      if (decrypted !== VERIFY_SENTINEL) {
        throw new Error('Decrypted value did not match the original');
      }
    });
    logger.info({ provider: activeProviderName }, 'Token encryption verified');
  } catch (err) {
    logger.error(
      { err: serializeError(err), provider: activeProviderName },
      'Token encryption verification failed; stored tokens cannot be read or written',
    );
  }
}
