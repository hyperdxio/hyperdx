import { renderHook } from '@testing-library/react';

import { CsvColumn, useCsvExport } from '../useCsvExport';

describe('useCsvExport', () => {
  const mockColumns: CsvColumn[] = [
    { dataKey: 'name', displayName: 'Name' },
    { dataKey: 'age', displayName: 'Age' },
    { dataKey: 'email', displayName: 'Email Address' },
  ];

  const mockData = [
    { name: 'John Doe', age: 30, email: 'john@example.com' },
    { name: 'Jane Smith', age: 25, email: 'jane@example.com' },
    { name: 'Bob Wilson', age: 35, email: 'bob@example.com' },
  ];

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('basic functionality', () => {
    it('transforms data correctly with valid inputs', () => {
      const { result } = renderHook(() => useCsvExport(mockData, mockColumns));

      expect(result.current.csvData).toEqual([
        { Name: 'John Doe', Age: '30', 'Email Address': 'john@example.com' },
        { Name: 'Jane Smith', Age: '25', 'Email Address': 'jane@example.com' },
        { Name: 'Bob Wilson', Age: '35', 'Email Address': 'bob@example.com' },
      ]);
      expect(result.current.actualRowCount).toBe(3);
      expect(result.current.isDataEmpty).toBe(false);
      expect(result.current.isLimited).toBe(false);
    });

    it('uses display names as CSV headers', () => {
      const { result } = renderHook(() => useCsvExport(mockData, mockColumns));
      const csvData = result.current.csvData;

      expect(csvData[0]).toHaveProperty('Name');
      expect(csvData[0]).toHaveProperty('Age');
      expect(csvData[0]).toHaveProperty('Email Address');
      expect(csvData[0]).not.toHaveProperty('name');
      expect(csvData[0]).not.toHaveProperty('email');
    });
  });

  describe('data type handling', () => {
    it('handles null and undefined values', () => {
      const dataWithNulls = [
        { name: 'John', age: null, email: undefined },
        { name: null, age: 30, email: 'test@example.com' },
      ];

      const { result } = renderHook(() =>
        useCsvExport(dataWithNulls, mockColumns),
      );

      expect(result.current.csvData).toEqual([
        { Name: 'John', Age: '', 'Email Address': '' },
        { Name: '', Age: '30', 'Email Address': 'test@example.com' },
      ]);
    });

    it('handles object values by JSON stringifying them', () => {
      const dataWithObjects = [
        {
          name: 'John',
          age: 30,
          email: {
            primary: 'john@example.com',
            secondary: 'john2@example.com',
          },
        },
      ];

      const { result } = renderHook(() =>
        useCsvExport(dataWithObjects, mockColumns),
      );

      expect(result.current.csvData[0]['Email Address']).toBe(
        '{"primary":"john@example.com","secondary":"john2@example.com"}',
      );
    });

    it('handles values with commas correctly', () => {
      const dataWithCommas = [
        { name: 'Doe, John', age: 30, email: 'john@example.com' },
        { name: 'Smith, Jane', age: 25, email: 'jane@test,domain.com' },
      ];

      const { result } = renderHook(() =>
        useCsvExport(dataWithCommas, mockColumns),
      );

      expect(result.current.csvData).toEqual([
        { Name: 'Doe, John', Age: '30', 'Email Address': 'john@example.com' },
        {
          Name: 'Smith, Jane',
          Age: '25',
          'Email Address': 'jane@test,domain.com',
        },
      ]);
    });
  });

  describe('data filtering', () => {
    it('filters out non-object rows', () => {
      const mixedData = [
        { name: 'John', age: 30, email: 'john@example.com' },
        'invalid string',
        42,
        null,
        undefined,
        { name: 'Jane', age: 25, email: 'jane@example.com' },
      ];

      const { result } = renderHook(() => useCsvExport(mixedData, mockColumns));

      expect(result.current.csvData).toHaveLength(2);
      expect(result.current.csvData).toEqual([
        { Name: 'John', Age: '30', 'Email Address': 'john@example.com' },
        { Name: 'Jane', Age: '25', 'Email Address': 'jane@example.com' },
      ]);
    });

    it('filters out rows that error during processing', () => {
      const problematicData = [
        { name: 'John', age: 30, email: 'john@example.com' },
        {
          get name() {
            throw new Error('Getter error');
          },
          age: 25,
          email: 'error@example.com',
        },
        { name: 'Jane', age: 25, email: 'jane@example.com' },
      ];

      const { result } = renderHook(() =>
        useCsvExport(problematicData, mockColumns),
      );

      expect(result.current.csvData).toHaveLength(2);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error processing row 1:'),
        expect.any(Error),
      );
    });
  });

  describe('row limiting', () => {
    it('limits rows to maxRows option', () => {
      const largeData = Array.from({ length: 10 }, (_, i) => ({
        name: `Person ${i}`,
        age: 20 + i,
        email: `person${i}@example.com`,
      }));

      const { result } = renderHook(() =>
        useCsvExport(largeData, mockColumns, { maxRows: 5 }),
      );

      expect(result.current.csvData).toHaveLength(5);
      expect(result.current.isLimited).toBe(true);
      expect(result.current.maxRows).toBe(5);
    });

    it('uses default max rows (4000)', () => {
      const { result } = renderHook(() => useCsvExport(mockData, mockColumns));
      expect(result.current.maxRows).toBe(4000);
    });

    it('indicates when data is not limited', () => {
      const { result } = renderHook(() =>
        useCsvExport(mockData, mockColumns, { maxRows: 10 }),
      );

      expect(result.current.isLimited).toBe(false);
    });
  });

  describe('group column functionality', () => {
    it('adds group column when specified', () => {
      const dataWithGroups = [
        { name: 'John', age: 30, email: 'john@example.com', group: 'A' },
        { name: 'Jane', age: 25, email: 'jane@example.com', group: 'B' },
      ];

      const { result } = renderHook(() =>
        useCsvExport(dataWithGroups, mockColumns, {
          groupColumnName: 'Category',
        }),
      );

      expect(result.current.csvData).toEqual([
        {
          Category: 'A',
          Name: 'John',
          Age: '30',
          'Email Address': 'john@example.com',
        },
        {
          Category: 'B',
          Name: 'Jane',
          Age: '25',
          'Email Address': 'jane@example.com',
        },
      ]);
    });

    it('handles missing group values', () => {
      const dataWithMissingGroups = [
        { name: 'John', age: 30, email: 'john@example.com' },
        { name: 'Jane', age: 25, email: 'jane@example.com', group: 'B' },
      ];

      const { result } = renderHook(() =>
        useCsvExport(dataWithMissingGroups, mockColumns, {
          groupColumnName: 'Category',
        }),
      );

      expect(result.current.csvData[0]).toHaveProperty('Category', '');
      expect(result.current.csvData[1]).toHaveProperty('Category', 'B');
    });
  });

  describe('error handling', () => {
    it('handles empty data array', () => {
      const { result } = renderHook(() => useCsvExport([], mockColumns));

      expect(result.current.csvData).toEqual([]);
      expect(result.current.isDataEmpty).toBe(true);
      expect(result.current.actualRowCount).toBe(0);
    });

    it('handles non-array data', () => {
      const { result } = renderHook(() =>
        useCsvExport('not an array' as any, mockColumns),
      );

      expect(result.current.csvData).toEqual([]);
      expect(result.current.isDataEmpty).toBe(true);
    });

    it('handles empty columns array', () => {
      const { result } = renderHook(() => useCsvExport(mockData, []));

      expect(result.current.csvData).toEqual([]);
      expect(result.current.isDataEmpty).toBe(true);
    });

    it('handles invalid column structure', () => {
      const invalidColumns = [
        { dataKey: 'name', displayName: 'Name' },
        { dataKey: '', displayName: 'Invalid' }, // Empty dataKey
        { dataKey: 'age' } as any, // Missing displayName
      ];

      const { result } = renderHook(() =>
        useCsvExport(mockData, invalidColumns),
      );

      expect(result.current.csvData).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(
        'CSV Export: Invalid column structure detected',
        expect.any(Array),
      );
    });
  });

  describe('memoization', () => {
    it('memoizes result when inputs are unchanged', () => {
      const { result, rerender } = renderHook(
        ({ data, columns }) => useCsvExport(data, columns),
        { initialProps: { data: mockData, columns: mockColumns } },
      );

      const firstResult = result.current;

      rerender({ data: mockData, columns: mockColumns });

      expect(result.current).toBe(firstResult);
    });

    it('recalculates when data changes', () => {
      const { result, rerender } = renderHook(
        ({ data }) => useCsvExport(data, mockColumns),
        { initialProps: { data: mockData } },
      );

      const firstResult = result.current;
      const newData = [
        ...mockData,
        { name: 'New Person', age: 40, email: 'new@example.com' },
      ];

      rerender({ data: newData });

      expect(result.current).not.toBe(firstResult);
      expect(result.current.csvData).toHaveLength(4);
    });
  });
});
