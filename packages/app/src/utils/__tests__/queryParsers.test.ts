import {
  dashboardFilterValuesParser,
  parseAsJsonEncoded,
  parseAsStringEncoded,
} from '@/utils/queryParsers';

// Helper: extract the parse/serialize functions from the parser object
const stringParser = parseAsStringEncoded;
const jsonParser = parseAsJsonEncoded<unknown>();

describe('parseAsStringEncoded', () => {
  describe('parse', () => {
    it('decodes a double-encoded value (new format)', () => {
      // serialize produces encodeURIComponent(value); nuqs double-encodes % → %25.
      // URLSearchParams.get() strips one layer, leaving our encoded value.
      expect(stringParser.parse('hello%20world')).toBe('hello world');
    });

    it('handles plain string with no encoding (old format)', () => {
      // decodeURIComponent on a plain string is a no-op
      expect(stringParser.parse('hello world')).toBe('hello world');
    });

    it('decodes special characters', () => {
      expect(stringParser.parse('a%3Ab')).toBe('a:b');
      expect(stringParser.parse('%5B%5D')).toBe('[]');
    });

    it('returns value as-is on malformed URI sequence', () => {
      // '%zz' is not valid percent-encoding
      expect(stringParser.parse('hello%zz')).toBe('hello%zz');
    });
  });

  describe('serialize', () => {
    it('encodes spaces as %20', () => {
      expect(stringParser.serialize('hello world')).toBe('hello%20world');
    });

    it('encodes special characters', () => {
      expect(stringParser.serialize('a+b')).toBe('a%2Bb');
      expect(stringParser.serialize('[1,2]')).toBe('%5B1%2C2%5D');
    });

    it('round-trips through parse → serialize', () => {
      const original = 'foo bar+baz [test]';
      expect(stringParser.parse(stringParser.serialize(original))).toBe(
        original,
      );
    });
  });
});

describe('parseAsJsonEncoded', () => {
  describe('parse', () => {
    it('parses a double-encoded JSON value (new format)', () => {
      // New format: serialize encodes JSON via encodeURIComponent; after
      // URLSearchParams.get() strips one layer our parse receives the once-encoded string.
      const value = [{ key: 'hello world' }];
      const serialized = jsonParser.serialize(value); // encodeURIComponent(JSON.stringify(value))
      expect(jsonParser.parse(serialized)).toEqual(value);
    });

    it('parses plain JSON string (old format — no double-encoding)', () => {
      // Old format: nuqs wrote raw JSON, URLSearchParams.get() decoded + → space already.
      const raw = JSON.stringify([{ key: 'value' }]);
      expect(jsonParser.parse(raw)).toEqual([{ key: 'value' }]);
    });

    it('parses old-format URL where nuqs used + for spaces', () => {
      // URLSearchParams.get() already turned + into space, so we receive a space.
      const raw = JSON.stringify([{ key: 'hello world' }]);
      expect(jsonParser.parse(raw)).toEqual([{ key: 'hello world' }]);
    });

    it.each(['%2F', '%20', '%25'])(
      'preserves literal %s text in legacy JSON',
      sequence => {
        const raw = JSON.stringify([{ query: `path${sequence}segment` }]);
        expect(jsonParser.parse(raw)).toEqual([
          { query: `path${sequence}segment` },
        ]);
      },
    );

    it('returns null for malformed JSON after successful URI decode', () => {
      // A valid percent-sequence that decodes to something that is not JSON.
      expect(jsonParser.parse('not-json')).toBeNull();
    });

    it('returns null for truly malformed input', () => {
      // Both decode and parse should fail gracefully.
      expect(jsonParser.parse('%zz{broken')).toBeNull();
    });

    it('does not fall back to raw parse when decode succeeds but JSON is malformed', () => {
      // encodeURIComponent('bad json') is a valid URI sequence that decodes to 'bad json'.
      // The old fallback would try JSON.parse('bad json') → still null, but with the
      // new separated logic this is handled cleanly without masking.
      const encoded = encodeURIComponent('bad json');
      expect(jsonParser.parse(encoded)).toBeNull();
    });
  });

  describe('serialize', () => {
    it('encodes JSON as a URI component', () => {
      const value = [{ key: 'a b' }];
      const serialized = jsonParser.serialize(value);
      expect(serialized).toBe(encodeURIComponent(JSON.stringify(value)));
    });

    it('round-trips through parse → serialize', () => {
      const original = [{ key: 'hello world', num: 42 }];
      expect(jsonParser.parse(jsonParser.serialize(original))).toEqual(
        original,
      );
    });
  });

  describe('with a validator', () => {
    // Accepts only an array of numbers; throws otherwise (mirrors zod.parse).
    const numberArrayParser = parseAsJsonEncoded<number[]>(value => {
      if (!Array.isArray(value) || !value.every(n => typeof n === 'number')) {
        throw new Error('expected number[]');
      }
      return value;
    });

    it('returns a value that satisfies the validator', () => {
      expect(
        numberArrayParser.parse(numberArrayParser.serialize([1, 2, 3])),
      ).toEqual([1, 2, 3]);
    });

    it.each([
      ['an object', {}],
      ['a bare number', 5],
      ['a bare string', 'x'],
      ['a null literal', null],
      ['an array of the wrong element type', ['a', 'b']],
    ])('returns null for %s (valid JSON, wrong shape)', (_label, input) => {
      const serialized = encodeURIComponent(JSON.stringify(input));
      expect(numberArrayParser.parse(serialized)).toBeNull();
    });

    it('returns null when the validator returns null instead of throwing', () => {
      const nullingParser = parseAsJsonEncoded<number[]>(() => null);
      expect(nullingParser.parse(encodeURIComponent('[1,2,3]'))).toBeNull();
    });

    it('still returns null for non-JSON input before validation runs', () => {
      const validate = jest.fn();
      const parser = parseAsJsonEncoded<unknown>(validate);
      expect(parser.parse('not-json')).toBeNull();
      expect(validate).not.toHaveBeenCalled();
    });
  });
});

describe('dashboardFilterValuesParser', () => {
  // Encoded the same way `serialize` does, but built here so the malformed
  // shapes below don't have to be cast through the parser's value type.
  const parse = (value: unknown) =>
    dashboardFilterValuesParser.parse(
      encodeURIComponent(JSON.stringify(value)),
    );

  const sqlEntry = { type: 'sql', condition: "ServiceName IN ('accounting')" };
  const variableEntry = {
    type: 'variable',
    name: 'svc',
    values: ['accounting'],
  };

  it('parses an array of legacy expression-keyed entries', () => {
    expect(parse([sqlEntry])).toEqual([sqlEntry]);
  });

  it('parses an array of variable-keyed entries', () => {
    expect(parse([variableEntry])).toEqual([variableEntry]);
  });

  it('parses a mixed array, preserving order', () => {
    expect(parse([sqlEntry, variableEntry])).toEqual([sqlEntry, variableEntry]);
  });

  it('parses an empty array', () => {
    expect(parse([])).toEqual([]);
  });

  it.each([
    ['a bare number', 5],
    ['an object', {}],
    ['a bare string', 'x'],
    ['a null literal', null],
  ])('returns null for %s', (_label, input) => {
    expect(parse(input)).toBeNull();
  });

  it('drops a single invalid entry and keeps the rest', () => {
    // A variable entry with no `name` can't address anything; the sql entry
    // beside it should still apply.
    expect(parse([{ type: 'variable', values: ['a'] }, sqlEntry])).toEqual([
      sqlEntry,
    ]);
  });

  it('reads raw JSON written by an older client', () => {
    expect(
      dashboardFilterValuesParser.parse(JSON.stringify([sqlEntry])),
    ).toEqual([sqlEntry]);
  });

  it('reads a percent-encoded param', () => {
    expect(
      dashboardFilterValuesParser.parse(
        encodeURIComponent(JSON.stringify([variableEntry])),
      ),
    ).toEqual([variableEntry]);
  });

  it('strips unknown keys from an entry', () => {
    expect(parse([{ ...variableEntry, somethingNew: true }])).toEqual([
      variableEntry,
    ]);
  });
});
