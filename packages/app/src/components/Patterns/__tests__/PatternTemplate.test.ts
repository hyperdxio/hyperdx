import {
  PATTERN_WILDCARD,
  splitPatternTemplate,
} from '@/components/Patterns/PatternTemplate';

describe('splitPatternTemplate', () => {
  it('is a single text part when nothing varied', () => {
    expect(splitPatternTemplate('connection refused')).toEqual([
      { type: 'text', value: 'connection refused', at: 0 },
    ]);
  });

  it('marks each Drain placeholder as a slot', () => {
    expect(splitPatternTemplate('GET /api/products/<*> HTTP/1.1')).toEqual([
      { type: 'text', value: 'GET /api/products/', at: 0 },
      { type: 'slot', at: 18 },
      { type: 'text', value: ' HTTP/1.1', at: 21 },
    ]);
  });

  it('keeps adjacent slots when two placeholders sit together', () => {
    expect(splitPatternTemplate(`<*>${PATTERN_WILDCARD}`)).toEqual([
      { type: 'slot', at: 0 },
      { type: 'slot', at: 3 },
    ]);
  });

  it('is empty for empty input', () => {
    expect(splitPatternTemplate('')).toEqual([]);
  });
});
