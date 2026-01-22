import { TSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import useFieldExpressionGenerator from '../useFieldExpressionGenerator';
import { useJsonColumns } from '../useMetadata';

// Mock dependencies
jest.mock('../useMetadata', () => ({
  useJsonColumns: jest.fn(),
}));

describe('useFieldExpressionGenerator', () => {
  const mockSource = {
    from: {
      databaseName: 'test_db',
      tableName: 'traces',
    },
    connection: 'conn1',
  } as TSource;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return undefined getFieldExpression when source is undefined', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as any);

    const { result } = renderHook(() => useFieldExpressionGenerator(undefined));

    expect(result.current.getFieldExpression).toBeUndefined();
    expect(result.current.isLoading).toBeFalsy();
  });

  it('should return isLoading true when data is loading', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    expect(result.current.getFieldExpression).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('should generate JSON column expression with default convertFn (toString)', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: ['Body', 'Metadata'],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    expect(result.current.getFieldExpression).toBeDefined();
    expect(result.current.isLoading).toBeFalsy();

    const expression = result.current.getFieldExpression!(
      'Body',
      'error.message',
    );
    expect(expression).toBe('toString(`Body`.`error`.`message`)');
  });

  it('should generate JSON column expression with custom convertFn', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: ['Body', 'Metadata'],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    expect(result.current.getFieldExpression).toBeDefined();

    const expression = result.current.getFieldExpression!(
      'Body',
      'count',
      'toInt64',
    );
    expect(expression).toBe('toInt64(`Body`.`count`)');
  });

  it('should generate Map column expression with bracket notation', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: ['Body', 'Metadata'],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    expect(result.current.getFieldExpression).toBeDefined();

    const expression = result.current.getFieldExpression!(
      'ResourceAttributes',
      'service.name',
    );
    expect(expression).toBe("`ResourceAttributes`['service.name']");
  });

  it('should handle mixed JSON and Map columns correctly', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: ['Body'],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    // JSON column should use SqlString.format
    const jsonExpression = result.current.getFieldExpression!('Body', 'key1');
    expect(jsonExpression).toBe('toString(`Body`.`key1`)');

    // Map column should use bracket notation
    const mapExpression = result.current.getFieldExpression!(
      'ResourceAttributes',
      'key2',
    );
    expect(mapExpression).toBe("`ResourceAttributes`['key2']");
  });

  it('should handle empty jsonColumns array', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    expect(result.current.getFieldExpression).toBeDefined();

    // All columns should be treated as Map columns
    const expression = result.current.getFieldExpression!(
      'ResourceAttributes',
      'service.name',
    );
    expect(expression).toBe("`ResourceAttributes`['service.name']");
  });

  it('should pass correct tableConnection to useJsonColumns', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    renderHook(() => useFieldExpressionGenerator(mockSource));

    expect(useJsonColumns).toHaveBeenCalledWith({
      databaseName: 'test_db',
      tableName: 'traces',
      connectionId: 'conn1',
    });
  });

  it('should handle special characters in keys correctly', () => {
    jest.mocked(useJsonColumns).mockReturnValue({
      data: ['Body'],
      isLoading: false,
    } as any);

    const { result } = renderHook(() =>
      useFieldExpressionGenerator(mockSource),
    );

    // JSON column with special characters
    const jsonExpression = result.current.getFieldExpression!(
      'Body',
      "user's key",
    );
    expect(jsonExpression).toBe("toString(`Body`.`user's key`)");

    // Map column with special characters - bracket notation handles it
    const mapExpression = result.current.getFieldExpression!(
      'ResourceAttributes',
      "user's key",
    );
    expect(mapExpression).toBe("`ResourceAttributes`['user\\'s key']");
  });
});
