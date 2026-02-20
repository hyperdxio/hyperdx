import {
  parseAsCompressedJson,
  parseAsCompressedString,
} from '../queryParsers';
import {
  compressStringParam,
  compressUrlParam,
  decompressStringParam,
  decompressUrlParam,
} from '../urlCompression';

// A realistic Filter[] value as would appear in the `filters` URL param
const SAMPLE_FILTERS = [
  { type: 'sql', condition: "service IN ('myapp', 'api-gateway')" },
  { type: 'sql', condition: "level NOT IN ('debug')" },
  { type: 'sql', condition: 'status_code BETWEEN 400 AND 599' },
];

// A realistic SQL where clause as would appear in the `where` URL param
const SAMPLE_WHERE =
  "service = 'myapp' AND (level = 'error' OR level = 'warn')";

// A SQL where clause with newlines (multi-line queries)
const SAMPLE_WHERE_MULTILINE =
  "service = 'myapp'\nAND level = 'error'\nAND status = 500";

describe('compressUrlParam', () => {
  it('produces a non-empty string for an empty array', () => {
    const result = compressUrlParam([]);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('produces a non-empty string for an empty object', () => {
    const result = compressUrlParam({});
    expect(result).toBeTruthy();
  });

  it('produces URL-safe output (no brackets, braces, quotes, spaces)', () => {
    const result = compressUrlParam(SAMPLE_FILTERS);
    expect(result).not.toMatch(/[[{}"'\s]/);
  });

  it('produces shorter output than JSON.stringify for large filter arrays', () => {
    // LZ-string has overhead on small payloads; compression pays off on larger,
    // repetitive structures as seen in real dashboard/chart configs
    const largeFilters = Array.from({ length: 15 }, (_, i) => ({
      type: 'sql',
      condition: `service_name IN ('myapp', 'api-gateway', 'frontend-${i}') AND level NOT IN ('debug', 'trace')`,
    }));
    const compressed = compressUrlParam(largeFilters);
    const raw = JSON.stringify(largeFilters);
    expect(compressed.length).toBeLessThan(raw.length);
  });
});

describe('decompressUrlParam', () => {
  describe('new format (lz-string compressed)', () => {
    it('round-trips an empty array', () => {
      expect(decompressUrlParam(compressUrlParam([]))).toEqual([]);
    });

    it('round-trips an empty object', () => {
      expect(decompressUrlParam(compressUrlParam({}))).toEqual({});
    });

    it('round-trips a realistic Filter[] array', () => {
      expect(decompressUrlParam(compressUrlParam(SAMPLE_FILTERS))).toEqual(
        SAMPLE_FILTERS,
      );
    });

    it('round-trips a complex chart config object', () => {
      const config = {
        source: 'abc123',
        select: 'timestamp, body, level',
        where: SAMPLE_WHERE,
        filters: SAMPLE_FILTERS,
        displayType: 'table',
      };
      expect(decompressUrlParam(compressUrlParam(config))).toEqual(config);
    });
  });

  describe('old format (plain JSON — backwards compatibility)', () => {
    it('parses a plain JSON array from an old URL', () => {
      const oldValue = JSON.stringify(SAMPLE_FILTERS);
      expect(decompressUrlParam(oldValue)).toEqual(SAMPLE_FILTERS);
    });

    it('parses a plain JSON object from an old URL', () => {
      const oldValue = JSON.stringify({ source: 'abc', where: 'level=error' });
      expect(decompressUrlParam(oldValue)).toEqual({
        source: 'abc',
        where: 'level=error',
      });
    });

    it('parses an empty JSON array from an old URL', () => {
      expect(decompressUrlParam('[]')).toEqual([]);
    });
  });

  describe('invalid / corrupt values', () => {
    it('returns null for a completely invalid string', () => {
      expect(decompressUrlParam('not-valid-at-all')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(decompressUrlParam('')).toBeNull();
    });
  });
});

describe('compressStringParam', () => {
  it('produces a non-empty string for an empty string', () => {
    const result = compressStringParam('');
    expect(result).toBeTruthy();
  });

  it('produces URL-safe output (no spaces, quotes, parens, brackets)', () => {
    const result = compressStringParam(SAMPLE_WHERE);
    expect(result).not.toMatch(/[\s"'()[\]{}]/);
  });

  it('produces URL-safe output for SQL with parentheses (Teams-unsafe chars)', () => {
    const sql = "status IN (200, 404) AND (service = 'api' OR service = 'web')";
    const result = compressStringParam(sql);
    expect(result).not.toMatch(/[()'"]/);
  });
});

describe('decompressStringParam', () => {
  describe('new format (lz-string compressed)', () => {
    it('round-trips a simple SQL where clause', () => {
      expect(decompressStringParam(compressStringParam(SAMPLE_WHERE))).toBe(
        SAMPLE_WHERE,
      );
    });

    it('round-trips a multi-line SQL query', () => {
      expect(
        decompressStringParam(compressStringParam(SAMPLE_WHERE_MULTILINE)),
      ).toBe(SAMPLE_WHERE_MULTILINE);
    });

    it('round-trips an empty string', () => {
      expect(decompressStringParam(compressStringParam(''))).toBe('');
    });

    it('round-trips SQL with parentheses', () => {
      const sql =
        "status IN (200, 404) AND (service = 'api' OR service = 'web')";
      expect(decompressStringParam(compressStringParam(sql))).toBe(sql);
    });
  });

  describe('old format (plain string — backwards compatibility)', () => {
    it('returns a plain string from an old URL unchanged', () => {
      expect(decompressStringParam(SAMPLE_WHERE)).toBe(SAMPLE_WHERE);
    });

    it('returns an empty string from an old URL unchanged', () => {
      expect(decompressStringParam('')).toBe('');
    });

    it('converts legacy %0A encoding to newlines (parseAsStringWithNewLines compat)', () => {
      const oldValue = "service = 'myapp'%0AAND level = 'error'";
      expect(decompressStringParam(oldValue)).toBe(
        "service = 'myapp'\nAND level = 'error'",
      );
    });

    it('does not misinterpret a plain old-format value containing = (base64url char)', () => {
      // "status=200" decoded from a pre-compression URL; "=" is valid base64url
      // but should not be treated as LZ-compressed data
      expect(decompressStringParam('status=200')).toBe('status=200');
    });

    it('does not corrupt a value whose characters are all base64url-safe (e.g. A1B2C3)', () => {
      // Without the LZ_PREFIX guard, LZString.decompressFromEncodedURIComponent('A1B2C3')
      // returns non-null garbage (e.g. "°") instead of null, causing silent corruption.
      // The prefix-based format detection eliminates this false-positive entirely.
      expect(decompressStringParam('A1B2C3')).toBe('A1B2C3');
    });
  });
});

describe('parseAsCompressedString (nuqs parser)', () => {
  it('serialize → parse round-trips a SQL where clause', () => {
    const parser = parseAsCompressedString;
    const serialized = parser.serialize(SAMPLE_WHERE);
    expect(parser.parse(serialized)).toBe(SAMPLE_WHERE);
  });

  it('serialize produces URL-safe output', () => {
    const serialized = parseAsCompressedString.serialize(SAMPLE_WHERE);
    expect(serialized).not.toMatch(/[\s"'()[\]{}]/);
  });

  it('parse handles an old plain-string value (backwards compat)', () => {
    expect(parseAsCompressedString.parse(SAMPLE_WHERE)).toBe(SAMPLE_WHERE);
  });
});

describe('parseAsCompressedJson (nuqs parser)', () => {
  it('serialize → parse round-trips a Filter[] array', () => {
    const parser = parseAsCompressedJson<typeof SAMPLE_FILTERS>();
    const serialized = parser.serialize(SAMPLE_FILTERS);
    expect(parser.parse(serialized)).toEqual(SAMPLE_FILTERS);
  });

  it('serialize produces URL-safe output', () => {
    const parser = parseAsCompressedJson<typeof SAMPLE_FILTERS>();
    const serialized = parser.serialize(SAMPLE_FILTERS);
    expect(serialized).not.toMatch(/[\s"'()[\]{}]/);
  });

  it('parse handles an old plain-JSON value (backwards compat)', () => {
    const parser = parseAsCompressedJson<typeof SAMPLE_FILTERS>();
    expect(parser.parse(JSON.stringify(SAMPLE_FILTERS))).toEqual(
      SAMPLE_FILTERS,
    );
  });

  it('parse returns null for an invalid value', () => {
    const parser = parseAsCompressedJson<typeof SAMPLE_FILTERS>();
    expect(parser.parse('not-valid')).toBeNull();
  });
});
