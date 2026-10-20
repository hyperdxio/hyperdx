import { minePatterns } from '@hyperdx/common-utils/dist/drain';

import {
  andSql,
  buildPatternPredicate,
  MAX_PREDICATE_TEMPLATE_LENGTH,
  templateToRegex,
} from '@/mcp/tools/query/patternDrilldown';

// RE2 spells code points \x{HHHH} and categories \pZ; JS (with the u flag)
// spells them \u{HHHH} and \p{Z}. ClickHouse behaviour is covered by
// integration tests.
function toJsRegex(re2: string): RegExp {
  return RegExp(
    re2
      .replace(/\\x\{([0-9A-Fa-f]+)\}/g, '\\u{$1}')
      .replace(/(?<!\\)\\p([A-Z])/g, '\\p{$1}'),
    'u',
  );
}

function matches(template: string, value: string): boolean {
  return toJsRegex(templateToRegex(template)).test(value);
}

describe('templateToRegex', () => {
  it('keeps the variable position between literal tokens', () => {
    const t = 'Sending <*> rows';
    expect(matches(t, 'Sending 10 rows')).toBe(true);
    expect(matches(t, 'Sending 20 rows')).toBe(true);

    // The old Lucene snippet (Body:"Sending rows") required these two words
    // to be adjacent, so it matched none of the real messages above. The new
    // predicate must not broaden either: each of these differs in shape.
    expect(matches(t, 'Sending rows')).toBe(false);
    expect(matches(t, 'Sending 10 more rows')).toBe(false);
    expect(matches(t, 'Sending 10 rows now')).toBe(false);
    expect(matches(t, 'Resending 10 rows')).toBe(false);
    expect(matches(t, 'Sending 10 rowsX')).toBe(false);
    expect(matches(t, 'rows 10 Sending')).toBe(false);
  });

  it('matches whole tokens only', () => {
    expect(matches('user <*> logged in', 'user bob logged in')).toBe(true);
    expect(matches('user <*> logged in', 'superuser bob logged in')).toBe(
      false,
    );
    expect(matches('user <*> logged in', 'user bob logged inside')).toBe(false);
    expect(matches('a <*>', 'ab 1')).toBe(false);
  });

  it('handles repeated variables', () => {
    const t = 'copy <*> to <*> from <*>';
    expect(matches(t, 'copy a.txt to /tmp from host-1')).toBe(true);
    expect(matches(t, 'copy a.txt to /tmp from')).toBe(false);
    expect(matches(t, 'copy a.txt b.txt to /tmp from host-1')).toBe(false);
  });

  it('treats a template made only of variables as a token-count match', () => {
    expect(matches('<*> <*>', 'alpha beta')).toBe(true);
    expect(matches('<*> <*>', 'alpha')).toBe(false);
    expect(matches('<*> <*>', 'alpha beta gamma')).toBe(false);
  });

  it('escapes regex metacharacters, quotes and backslashes in literals', () => {
    const literal = String.raw`path=C:\temp "quoted" it's (x)*[y]+ $1 ^a|b {n} .?`;
    const t = `${literal} <*>`;
    expect(matches(t, `${literal} 42`)).toBe(true);
    // `.` must be literal, not "any character".
    expect(matches(t, `${literal.replace('.?', 'x?')} 42`)).toBe(false);
    // `*` and `+` must be literal, not quantifiers.
    expect(matches(t, `${literal.replace('(x)*', '(x)(x)')} 42`)).toBe(false);
    expect(matches(t, `${literal.replace('[y]+', '[y]]')} 42`)).toBe(false);
  });

  it('matches Unicode tokens separated by spaces, tabs and newlines', () => {
    const t = 'café <*> 日本';
    expect(matches(t, 'café x 日本')).toBe(true);
    expect(matches(t, '  café\n\tx   日本 \n')).toBe(true);
    expect(matches(t, 'cafe x 日本')).toBe(false);
    // U+200B (zero-width space) is not whitespace to Drain, so it is part of
    // the token and the value has only two tokens.
    expect(matches(t, 'café\u200Bx 日本')).toBe(false);
  });

  it('treats the Unicode whitespace Drain splits on as separators', () => {
    expect(matches('Connection <*> reset', '\uFEFFConnection 42 reset')).toBe(
      true,
    );
    expect(matches('<*> <*> EUR', '1\u202F234 EUR')).toBe(true);
    expect(matches('a <*> b', 'a\u00A0x\u3000b')).toBe(true);
    expect(matches('a <*> b', 'a x\u00A0y b')).toBe(false);
  });

  it('a variable spans one token, even a multi-byte one', () => {
    expect(matches('id <*> ok', 'id 日本語 ok')).toBe(true);
    expect(matches('id <*> ok', 'id 日本 語 ok')).toBe(false);
  });

  it('turns an empty template into a whitespace-only match', () => {
    expect(matches('', '')).toBe(true);
    expect(matches('', '  \n')).toBe(true);
    expect(matches('', 'x')).toBe(false);
  });

  it('matches every sampled member of every Drain cluster, and nothing from other shapes', () => {
    const messages = [
      ...[10, 20, 30, 40].map(n => `Sending ${n} rows`),
      ...[1, 2, 3].map(n => `Sending ${n} more rows`),
      ...['alice', 'bob', 'carol'].map(
        u => `User ${u} logged in from 10.0.0.${u.length}`,
      ),
      ...['a', 'b'].map(k => `cache miss for key "${k}\\x" (retry)`),
      'café ünïcode 日本 message',
    ];
    const { patterns } = minePatterns(
      messages.map(body => ({ body })),
      {
        totalCount: messages.length,
        startDate: new Date(0),
        endDate: new Date(1000),
        trendBuckets: 0,
        maxSamples: messages.length,
        getBody: r => r.body,
        getTimestamp: () => 0,
      },
    );
    expect(patterns.length).toBeGreaterThan(1);

    for (const p of patterns) {
      const re = toJsRegex(templateToRegex(p.pattern));
      const members = p.samples.map(s => s.body);
      expect(members).toHaveLength(p.sampleCount);
      for (const m of members) expect(re.test(m)).toBe(true);
      // Members of other clusters with a different shape must not match.
      const others = patterns
        .filter(o => o !== p)
        .flatMap(o => o.samples.map(s => s.body));
      for (const o of others) {
        if (re.test(o)) {
          // Only allowed when that cluster's template is a specialization
          // of this one (same shape); none of these fixtures overlap.
          throw new Error(`"${p.pattern}" unexpectedly matched "${o}"`);
        }
      }
    }
  });
});

describe('buildPatternPredicate', () => {
  it('wraps the selected value expression in match() with an escaped literal', () => {
    const predicate = buildPatternPredicate(
      "LogAttributes['exception.type']",
      String.raw`it's C:\x <*>`,
    );
    expect(predicate).toMatch(/^match\(LogAttributes\['exception\.type'\], '/);
    // Quote doubled for SQL, backslash doubled for SQL on top of the regex escape.
    expect(predicate).toContain("it''s");
    expect(predicate).toContain(String.raw`C:\\\\x`);
  });

  it('returns null for templates too long to turn into a predicate', () => {
    const long = 'x'.repeat(MAX_PREDICATE_TEMPLATE_LENGTH + 1);
    expect(buildPatternPredicate('Body', long)).toBeNull();
  });
});

describe('andSql', () => {
  it('skips blanks and parenthesizes when combining', () => {
    expect(andSql()).toBe('');
    expect(andSql('', undefined, '  ')).toBe('');
    expect(andSql('a = 1')).toBe('a = 1');
    expect(andSql('a = 1 OR b = 2', '', 'c = 3')).toBe(
      '(a = 1 OR b = 2) AND (c = 3)',
    );
  });
});
