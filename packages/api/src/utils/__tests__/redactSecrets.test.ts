import { REDACTION_PATTERN_NAMES, redactSecrets } from '../redactSecrets';

describe('redactSecrets', () => {
  describe('passes legitimate observability data through unchanged', () => {
    it('returns empty string unchanged', () => {
      expect(redactSecrets('')).toBe('');
    });

    it('leaves a normal log line alone', () => {
      const line = 'error: database timeout after 30s on host db-1';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not match the bare word "password"', () => {
      const line = 'user forgot their password and reset it';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not match "errorless" or other substring noise', () => {
      const line = 'request handled errorlessly with status 200';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not redact a generic hex blob without context', () => {
      const line = 'request id: 7f3a9b1c2d4e5f6a';
      expect(redactSecrets(line)).toBe(line);
    });
  });

  describe('key=value pairs', () => {
    it('redacts password=', () => {
      expect(redactSecrets('conn: password=secret123')).toBe(
        'conn: password=[REDACTED]',
      );
    });

    it('redacts api_key= and token= in one string', () => {
      const out = redactSecrets('api_key=abc123 token=xyz789');
      expect(out).toContain('api_key=[REDACTED]');
      expect(out).toContain('token=[REDACTED]');
    });

    it('preserves URL query-string boundaries', () => {
      const out = redactSecrets('GET /v1/items?token=abc&limit=10&api_key=xyz');
      expect(out).toContain('token=[REDACTED]');
      expect(out).toContain('limit=10');
      expect(out).toContain('api_key=[REDACTED]');
    });

    it('handles secret keys with hyphen or underscore variants', () => {
      const out = redactSecrets(
        'access-key=A access_key=B private-key=C client_secret=D',
      );
      expect(out).toContain('access-key=[REDACTED]');
      expect(out).toContain('access_key=[REDACTED]');
      expect(out).toContain('private-key=[REDACTED]');
      expect(out).toContain('client_secret=[REDACTED]');
    });

    it('redacts shell-style double-quoted values', () => {
      const out = redactSecrets('export PASSWORD="hunter2 with spaces"');
      expect(out).not.toContain('hunter2');
      expect(out).toContain('PASSWORD=[REDACTED]');
    });

    it('redacts shell-style single-quoted values', () => {
      const out = redactSecrets("API_KEY='abc 123'");
      expect(out).not.toContain('abc 123');
      expect(out).toContain('API_KEY=[REDACTED]');
    });
  });

  describe('JSON-shaped secrets', () => {
    it('redacts {"password":"..."}', () => {
      const out = redactSecrets('{"password":"s3cret","user":"alice"}');
      expect(out).not.toContain('s3cret');
      expect(out).toContain('"password":"[REDACTED]"');
      expect(out).toContain('"user":"alice"');
    });

    it('handles whitespace around the colon', () => {
      const out = redactSecrets('{ "api_key" : "abc123" }');
      expect(out).not.toContain('abc123');
      expect(out).toContain('[REDACTED]');
    });
  });

  describe('HTTP-style headers', () => {
    it('redacts X-Api-Key', () => {
      expect(redactSecrets('X-Api-Key: abc123')).toContain(
        'X-Api-Key: [REDACTED]',
      );
    });

    it('redacts X-Auth-Token', () => {
      expect(redactSecrets('X-Auth-Token: xyz')).toContain(
        'X-Auth-Token: [REDACTED]',
      );
    });

    it('redacts a bare Api-Key header', () => {
      expect(redactSecrets('Api-Key: abc123')).toContain('Api-Key: [REDACTED]');
    });
  });

  describe('Authorization header values', () => {
    it('redacts Bearer values', () => {
      expect(redactSecrets('Authorization: Bearer eyJhbG.xyz.abc')).toContain(
        'Bearer [REDACTED]',
      );
    });

    it('redacts Basic values', () => {
      expect(redactSecrets('Authorization: Basic dXNlcjpwYXNz')).toContain(
        'Basic [REDACTED]',
      );
    });
  });

  describe('JWT-shaped strings', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoxLCJleHAiOjE3MzM5OTk5OTl9.s1gnatur3';

    it('redacts a free-floating JWT', () => {
      expect(redactSecrets(`session: ${jwt}`)).toContain('[REDACTED_JWT]');
      expect(redactSecrets(`session: ${jwt}`)).not.toContain('s1gnatur3');
    });

    it('does not match a JWT-like fragment fused to surrounding word chars', () => {
      // No word boundary before "eyJ" in this string, so no match.
      const out = redactSecrets(`prefixeyJabc.def.ghi`);
      expect(out).toBe(`prefixeyJabc.def.ghi`);
    });
  });

  describe('PEM private key blocks', () => {
    const rsaKey = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEAyJk8Q...lots of base64...',
      'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789==',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    const opensshKey = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAA',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');

    it('redacts an RSA PEM block', () => {
      const out = redactSecrets(`leading text\n${rsaKey}\ntrailing text`);
      expect(out).toContain('[REDACTED_PRIVATE_KEY]');
      expect(out).not.toContain('MIIEpAIB');
      expect(out).toContain('leading text');
      expect(out).toContain('trailing text');
    });

    it('redacts an OPENSSH PEM block', () => {
      const out = redactSecrets(opensshKey);
      expect(out).toBe('[REDACTED_PRIVATE_KEY]');
    });

    it('redacts a PKCS#8 PRIVATE KEY block', () => {
      const pk8 = [
        '-----BEGIN PRIVATE KEY-----',
        'MIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8',
        '-----END PRIVATE KEY-----',
      ].join('\n');
      expect(redactSecrets(pk8)).toBe('[REDACTED_PRIVATE_KEY]');
    });

    it('does not redact a non-private PEM block', () => {
      const cert = [
        '-----BEGIN CERTIFICATE-----',
        'MIIDazCCAlOgAwIBAgIUJ',
        '-----END CERTIFICATE-----',
      ].join('\n');
      expect(redactSecrets(cert)).toBe(cert);
    });

    it('returns quickly when BEGIN has no matching END', () => {
      // Unmatched BEGIN with a large trailing payload; bounded lazy
      // quantifier should fail fast rather than scan the entire input.
      const noisy = 'x'.repeat(50_000);
      const input = `-----BEGIN RSA PRIVATE KEY-----\n${noisy}`;
      const start = Date.now();
      const out = redactSecrets(input);
      const elapsed = Date.now() - start;
      expect(out).toBe(input); // unchanged: no match
      expect(elapsed).toBeLessThan(500); // generous upper bound
    });
  });

  describe('basic-auth URLs', () => {
    it('redacts user:pass in https URL', () => {
      const out = redactSecrets(
        'clone https://alice:hunter2@github.com/acme/repo',
      );
      expect(out).toContain(
        'https://[REDACTED]:[REDACTED]@github.com/acme/repo',
      );
      expect(out).not.toContain('hunter2');
    });

    it('redacts user:pass in http URL', () => {
      const out = redactSecrets('proxy http://svc:hunter2@proxy.local:8080/');
      expect(out).toContain('http://[REDACTED]:[REDACTED]@proxy.local:8080/');
      expect(out).not.toContain('hunter2');
    });

    it('redacts a password that contains an @ character', () => {
      const out = redactSecrets('proxy http://svc:p@ss@proxy.local:8080/path');
      expect(out).toContain(
        'http://[REDACTED]:[REDACTED]@proxy.local:8080/path',
      );
      // The whole password including the embedded "@" must be gone.
      expect(out).not.toContain('p@ss');
      expect(out).not.toContain('ss@proxy');
    });

    it('preserves the host in the replacement', () => {
      const out = redactSecrets(
        'clone https://alice:hunter2@github.com/acme/repo',
      );
      expect(out).toContain(
        'https://[REDACTED]:[REDACTED]@github.com/acme/repo',
      );
    });

    it('does not match a URL without a password component', () => {
      const line = 'fetch https://api.example.com/v1/data';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not falsely match an email address', () => {
      const line = 'contact alice@example.com for access';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not match an ssh URL with only a username (no password)', () => {
      const line = 'fetch ssh://git@github.com/acme/repo';
      expect(redactSecrets(line)).toBe(line);
    });
  });

  describe('AWS access keys', () => {
    it('redacts AKIA-prefixed keys', () => {
      const out = redactSecrets('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
      expect(out).toContain('[REDACTED_AWS_KEY]');
      expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('redacts ASIA-prefixed STS session keys', () => {
      const out = redactSecrets('using ASIA1234567890ABCDEF for session');
      expect(out).toContain('[REDACTED_AWS_KEY]');
    });

    it('does not match AKIA without 16 trailing chars', () => {
      const line = 'AKIA short';
      expect(redactSecrets(line)).toBe(line);
    });

    it('does not match lowercase akia', () => {
      const line = 'akia1234567890abcdef';
      expect(redactSecrets(line)).toBe(line);
    });
  });

  describe('Slack tokens', () => {
    it('redacts xoxb bot tokens', () => {
      const out = redactSecrets('slack: xoxb-1234567890-abcdefghij');
      expect(out).toContain('[REDACTED_SLACK_TOKEN]');
      expect(out).not.toContain('xoxb-1234567890-abcdefghij');
    });

    it('redacts xoxp user tokens', () => {
      expect(redactSecrets('xoxp-9999999-aaaaaaaaaa')).toContain(
        '[REDACTED_SLACK_TOKEN]',
      );
    });

    it('does not match the bare prefix', () => {
      const line = 'something xox- not a token';
      expect(redactSecrets(line)).toBe(line);
    });
  });

  describe('GitHub tokens', () => {
    it('redacts ghp_ personal access tokens', () => {
      const tok = 'ghp_' + 'A'.repeat(36);
      const out = redactSecrets(`token: ${tok}`);
      expect(out).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(out).not.toContain(tok);
    });

    it('redacts gho_, ghu_, ghs_, ghr_ variants', () => {
      const tokens = [
        'gho_' + 'B'.repeat(36),
        'ghu_' + 'C'.repeat(36),
        'ghs_' + 'D'.repeat(36),
        'ghr_' + 'E'.repeat(36),
      ];
      for (const t of tokens) {
        expect(redactSecrets(t)).toBe('[REDACTED_GITHUB_TOKEN]');
      }
    });

    it('does not match the bare prefix or short fragments', () => {
      const line = 'ghp_short and gh_other';
      expect(redactSecrets(line)).toBe(line);
    });
  });

  describe('multi-secret payloads', () => {
    it('redacts every distinct secret in one pass', () => {
      const input = [
        'conn url: https://alice:hunter2@db.example.com/app',
        'auth: Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1IjoxfQ.sig',
        'aws: AKIAIOSFODNN7EXAMPLE',
        'gh: ghp_' + 'X'.repeat(36),
        'slack: xoxb-1111-aaaaaaaaaa',
        'env: password=hunter2 api_key=abc',
      ].join('\n');

      const out = redactSecrets(input);

      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(out).not.toContain('xoxb-1111-aaaaaaaaaa');
      expect(out).toContain('[REDACTED]:[REDACTED]@db.example.com');
      expect(out).toContain('Bearer [REDACTED]');
      expect(out).toContain('[REDACTED_AWS_KEY]');
      expect(out).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(out).toContain('[REDACTED_SLACK_TOKEN]');
      expect(out).toContain('password=[REDACTED]');
      expect(out).toContain('api_key=[REDACTED]');
    });
  });

  describe('pattern coverage', () => {
    it('exposes the expected pattern names', () => {
      expect(REDACTION_PATTERN_NAMES).toEqual(
        expect.arrayContaining([
          'pem',
          'basic-auth-url',
          'bearer',
          'basic',
          'jwt',
          'aws-access-key',
          'slack-token',
          'github-token',
          'key-value',
          'json-quoted',
          'http-header',
        ]),
      );
    });
  });
});
