// redactSecrets: best-effort allowlist redactor for LLM input that
// originates from observability data (log bodies, span attributes,
// pattern samples, alert payloads).
//
// Design rule: any LLM input derived from observability data goes
// through redactSecrets before leaving the API process. User-authored
// prose (e.g. the chart-builder assistant where the user types their
// own question) does NOT, because redacting the user's own input would
// strip exactly what they meant to ask.
//
// This is best-effort, not a guarantee. The patterns here are
// conservative: each one matches a high-confidence shape. False
// negatives (real secrets that slip through) are expected; false
// positives (legitimate data wrongly redacted) should be rare.
//
// Patterns covered:
//   pem               PEM key blocks (-----BEGIN ... PRIVATE KEY-----)
//   basic-auth-url    https://user:pass@host
//   key-value         password=secret, api_key=abc
//   json-quoted       {"password":"secret"} and similar
//   http-header       X-Api-Key: abc, Api-Key: abc
//   bearer            Authorization: Bearer xxx
//   basic             Authorization: Basic xxx
//   jwt               eyJ... three dot-separated base64 segments
//   aws-access-key    AKIA[16 chars], ASIA[16 chars]
//   slack-token       xox[a-z]-... shape
//   github-token      ghp_, gho_, ghu_, ghs_, ghr_ prefixes
//
// Known gaps (extend when seen in production):
//   URL-percent-encoded values, vendor-specific tokens (Stripe, Twilio,
//   Datadog, etc.), generic high-entropy hex blobs (too many false
//   positives without surrounding context), basic-auth URLs with raw
//   "@" in the username (ambiguous to parse without percent-encoding).

const SECRET_KEY_TOKENS =
  'password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|auth';

interface RedactionPattern {
  name: string;
  re: RegExp;
  replace: string;
}

// Order matters: broad multi-line patterns (PEM) run first so their
// inner contents do not match other narrower patterns. High-confidence
// shapes (Bearer, JWT, AWS, Slack, GitHub) run before the permissive
// key-value catch-all so that, e.g., "password=eyJ..." preserves the
// JWT shape inside the redacted value if it happened to leak.
const PATTERNS: RedactionPattern[] = [
  // -----BEGIN ... PRIVATE KEY----- ... -----END ... PRIVATE KEY-----
  // Covers RSA, EC, DSA, OPENSSH, and PKCS#8 (plain "PRIVATE KEY").
  // The algorithm prefix is optional to accept the bare "PRIVATE KEY" form.
  // The lazy quantifier is bounded so an unmatched BEGIN does not scan
  // an unbounded amount of trailing input. Real PEM blocks are well
  // under 16KB; the API also caps the whole request body at 50KB.
  {
    name: 'pem',
    re: /-----BEGIN (?:[A-Z][A-Z0-9 ]* )?PRIVATE KEY-----[\s\S]{0,16000}?-----END (?:[A-Z][A-Z0-9 ]* )?PRIVATE KEY-----/g,
    replace: '[REDACTED_PRIVATE_KEY]',
  },
  // scheme://user:pass@host. The password may contain "@" if not
  // percent-encoded, so the password group greedily consumes anything
  // non-whitespace, non-slash and the engine backtracks to the last
  // "@" before the host. The host group is captured so the replacement
  // preserves it. Raw "@" in the username is not handled (would need
  // ambiguous parsing); add to known gaps if seen in production.
  {
    name: 'basic-auth-url',
    re: /\b(https?|ftp|ssh):\/\/([^/\s:@]+):([^/\s]+)@([^/\s@]+)/g,
    replace: '$1://[REDACTED]:[REDACTED]@$4',
  },
  // Authorization: Bearer xxx
  {
    name: 'bearer',
    re: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replace: 'Bearer [REDACTED]',
  },
  // Authorization: Basic xxx (base64 user:pass)
  {
    name: 'basic',
    re: /Basic\s+[A-Za-z0-9+/=]+/gi,
    replace: 'Basic [REDACTED]',
  },
  // JWT-shape: three dot-separated base64url segments starting with eyJ.
  // Word boundary on the front prevents matching mid-token concatenations.
  {
    name: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replace: '[REDACTED_JWT]',
  },
  // AWS Access Key IDs. AKIA = long-lived, ASIA = STS session.
  {
    name: 'aws-access-key',
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: '[REDACTED_AWS_KEY]',
  },
  // Slack tokens. Common prefixes: xoxa, xoxb, xoxe, xoxo, xoxp, xoxr, xoxs.
  {
    name: 'slack-token',
    re: /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
    replace: '[REDACTED_SLACK_TOKEN]',
  },
  // GitHub token shapes: ghp_ (PAT), gho_ (oauth), ghu_ (user-to-server),
  // ghs_ (server-to-server), ghr_ (refresh). Real ones are 36+ chars
  // after the prefix; floor at 20 to catch shortened test fixtures.
  {
    name: 'github-token',
    re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    replace: '[REDACTED_GITHUB_TOKEN]',
  },
  // key=value where the key looks secret-ish. Three variants on the
  // value: double-quoted, single-quoted, or unquoted. Unquoted stops
  // at whitespace, commas, semicolons, ampersands, and quotes so URL
  // query-string boundaries are preserved. Quoted variants are
  // matched first via alternation so shell-style password="secret"
  // gets caught instead of slipping through the unquoted-value class.
  {
    name: 'key-value',
    re: new RegExp(
      `\\b(${SECRET_KEY_TOKENS})=(?:"[^"]*"|'[^']*'|[^\\s,;&"'\`]+)`,
      'gi',
    ),
    replace: '$1=[REDACTED]',
  },
  // JSON shape: "key": "value" with whitespace tolerance.
  {
    name: 'json-quoted',
    re: new RegExp(`("(?:${SECRET_KEY_TOKENS})"\\s*:\\s*)"[^"]*"`, 'gi'),
    replace: '$1"[REDACTED]"',
  },
  // HTTP-style secret headers on a single line. Covers X-Api-Key,
  // X-Auth-Token, X-Access-Token, Api-Key.
  {
    name: 'http-header',
    re: new RegExp(
      `\\b(x[-_]?(?:api[-_]?key|auth[-_]?token|access[-_]?token)|api[-_]?key)\\s*:\\s*([^\\s,;]+)`,
      'gi',
    ),
    replace: '$1: [REDACTED]',
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

// Exposed for tests that want to assert pattern coverage. Not part of
// the public API; the names are not contractual.
export const REDACTION_PATTERN_NAMES = PATTERNS.map(p => p.name);
