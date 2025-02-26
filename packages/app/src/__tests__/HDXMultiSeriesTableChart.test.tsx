import { generateCsvData } from '../HDXMultiSeriesTableChart';

describe('HDXMultiSeriesTableChart CSV functionality', () => {
  test('generateCsvData should correctly format data for CSV export', () => {
    const mockData = [
      { group: 'Group A', value1: 100, value2: 200 },
      { group: 'Group B', value1: 300, value2: 400 },
    ];

    const mockColumns = [
      { dataKey: 'value1', displayName: 'Value 1' },
      { dataKey: 'value2', displayName: 'Value 2' },
    ];

    const groupColumnName = 'Group Name';

    const expected = [
      { 'Group Name': 'Group A', 'Value 1': 100, 'Value 2': 200 },
      { 'Group Name': 'Group B', 'Value 1': 300, 'Value 2': 400 },
    ];

    const result = generateCsvData(mockData, mockColumns, groupColumnName);

    expect(result).toEqual(expected);
  });

  test('generateCsvData should handle missing groupColumnName', () => {
    // Test data without group column name
    const mockData = [
      { group: 'Group A', value1: 100, value2: 200 },
      { group: 'Group B', value1: 300, value2: 400 },
    ];

    const mockColumns = [
      { dataKey: 'value1', displayName: 'Value 1' },
      { dataKey: 'value2', displayName: 'Value 2' },
    ];

    // Expected output without group column
    const expected = [
      { 'Value 1': 100, 'Value 2': 200 },
      { 'Value 1': 300, 'Value 2': 400 },
    ];

    const result = generateCsvData(mockData, mockColumns);

    expect(result).toEqual(expected);
  });
});
