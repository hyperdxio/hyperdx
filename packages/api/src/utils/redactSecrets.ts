// redactSecrets: best-effort allowlist redactor for LLM input that
// originates from observability data (log bodies, span attributes,
// pattern samples, alert payloads).
//
// **LLM-input only.** Do not use as a general-purpose secret redactor:
// the patterns are tuned for the shapes that show up in observability
// payloads, not for export pipelines, audit logs, or anywhere a missed
// secret has compliance consequences. A redactor for those callers
// needs a different threat model and probably entropy-based scanning.
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
//   basic-auth-url    scheme://user:pass@host. Schemes: http(s),
//                     ws(s), ftp, sftp, ssh, postgres(ql), mysql,
//                     mariadb, mongodb(+srv), mssql, sqlserver,
//                     snowflake, redis(s), amqp(s), kafka(+ssl),
//                     clickhouse, smtp(s), ldap(s), nats. Match is
//                     case-insensitive (RFC 3986 schemes are).
//   key-value         password=secret, api_key=abc
//   json-quoted       {"password":"secret"} and similar
//   http-header       X-Api-Key: abc, Api-Key: abc
//   bearer            Authorization: Bearer xxx. Token is \S+ so
//                     opaque non-JWT bearers (with ":", "%", or
//                     quote chars in them) round-trip cleanly.
//   basic             Authorization: Basic xxx
//   jwt               eyJ... three dot-separated base64 segments
//   aws-access-key    AKIA[16 chars], ASIA[16 chars]
//   slack-token       xox[a-z]-... shape
//   github-token      ghp_, gho_, ghu_, ghs_, ghr_ prefixes
//   llm-vendor-key    sk-... (OpenAI), sk-ant-... (Anthropic),
//                     AIza... (Google Gemini). This redactor
//                     specifically fronts an LLM-provider call, so
//                     vendor-shaped keys must not leak to the very
//                     provider that issued them.
//
// Known gaps (extend when seen in production):
//   URL-percent-encoded values; non-LLM vendor tokens (Stripe, Twilio,
//   Datadog, GCP / Google Maps, generic OAuth refresh shapes); generic
//   high-entropy hex blobs (too many false positives without
//   surrounding context); basic-auth URLs with raw "@" in the username
//   (ambiguous to parse without percent-encoding).

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
  // (RSA, EC, DSA, OPENSSH, PKCS#8). Bounded lazy match so an
  // unmatched BEGIN does not scan an unbounded trailing input.
  {
    name: 'pem',
    re: /-----BEGIN (?:[A-Z][A-Z0-9 ]* )?PRIVATE KEY-----[\s\S]{0,16000}?-----END (?:[A-Z][A-Z0-9 ]* )?PRIVATE KEY-----/g,
    replace: '[REDACTED_PRIVATE_KEY]',
  },
  // scheme://user:pass@host. Password may contain "@"; the engine
  // backtracks to the last "@" before the host. Host is captured and
  // preserved in the replacement. Match is case-insensitive (RFC 3986
  // declares schemes case-insensitive, so HTTPS://user:pw@host is the
  // same authority as the lowercase form). The scheme group covers
  // HTTP-family protocols plus the database / queue / messaging
  // connection strings most likely to land in observability payloads
  // with embedded credentials. Schemes listed alphabetically.
  {
    name: 'basic-auth-url',
    re: /\b(amqps?|clickhouse|ftp|https?|kafka(?:\+ssl)?|ldaps?|mariadb|mongodb(?:\+srv)?|mssql|mysql|nats|postgres(?:ql)?|rediss?|sftp|smtps?|snowflake|sqlserver|ssh|wss?):\/\/([^/\s:@]+):([^/\s]+)@([^/\s@]+)/gi,
    replace: '$1://[REDACTED]:[REDACTED]@$4',
  },
  // Authorization: Bearer xxx. RFC 6750's b64token alphabet
  // (alphanumerics, "-._~+/", optional "=" padding) is a strict
  // subset of \S+, and observability payloads regularly carry
  // opaque non-JWT bearers with ":", "%", or quote chars in them.
  // Anything narrower than \S+ leaks the suffix past [REDACTED];
  // \S+ stops at whitespace, which is what actually terminates a
  // bearer token in practice (header line break, log delimiter,
  // JSON field boundary).
  {
    name: 'bearer',
    re: /Bearer\s+\S+/gi,
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
  // LLM-vendor API keys: OpenAI ("sk-..."), Anthropic ("sk-ant-..."),
  // and adjacent vendors that follow the "sk-" convention; plus
  // Google Gemini ("AIza..." with 35 trailing chars, 39 total).
  // This redactor specifically fronts an LLM call; a leaked vendor
  // key would be exfiltrated to the very provider that issued it.
  // The "sk-" branch floors at 20 chars after the prefix to avoid
  // catching English words like "sk-ip-line" or short test fixtures
  // while still covering OpenAI's 48+ char and Anthropic's longer
  // formats. Gemini keys are exactly 39 chars wide.
  {
    name: 'llm-vendor-key',
    re: /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35})\b/g,
    replace: '[REDACTED_LLM_KEY]',
  },
  // key=value with secret-ish key. Three value forms: double-quoted,
  // single-quoted, or unquoted (stops at whitespace, comma, semicolon,
  // ampersand, quote so URL query-string boundaries are preserved).
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
