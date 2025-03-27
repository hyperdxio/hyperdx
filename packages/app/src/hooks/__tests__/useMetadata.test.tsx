import { deduplicate2dArray } from '../useMetadata';

describe('deduplicate2dArray', () => {
  // Test basic deduplication
  it('should remove duplicate objects across 2D array', () => {
    const input = [
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      [
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Charlie' },
      ],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ]);
  });

  // Test with empty arrays
  it('should handle empty 2D array', () => {
    const input: object[][] = [];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(0);
  });

  // Test with nested empty arrays
  it('should handle 2D array with empty subarrays', () => {
    const input = [[], [], []];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(0);
  });

  // Test with complex objects
  it('should deduplicate complex nested objects', () => {
    const input = [
      [
        { user: { id: 1, details: { name: 'Alice' } } },
        { user: { id: 2, details: { name: 'Bob' } } },
      ],
      [
        { user: { id: 1, details: { name: 'Alice' } } },
        { user: { id: 3, details: { name: 'Charlie' } } },
      ],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { user: { id: 1, details: { name: 'Alice' } } },
      { user: { id: 2, details: { name: 'Bob' } } },
      { user: { id: 3, details: { name: 'Charlie' } } },
    ]);
  });

  // Test with different types of objects
  it('should work with different types of objects', () => {
    const input: {
      value: any;
    }[][] = [
      [{ value: 'string' }, { value: 42 }],
      [{ value: 'string' }, { value: true }],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
  });

  // Test order preservation
  it('should preserve the order of first occurrence', () => {
    const input = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 1 }, { id: 3 }],
      [{ id: 4 }, { id: 2 }],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });
});
