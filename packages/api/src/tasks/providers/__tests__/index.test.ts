import { AlertProvider, isValidProvider } from '../index';

describe('isValidProvider', () => {
  it('should return true for a valid AlertProvider', () => {
    const validProvider: AlertProvider = {
      init: async () => {},
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(validProvider)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isValidProvider(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isValidProvider(undefined)).toBe(false);
  });

  it('should return false for a plain object', () => {
    const plainObject = { foo: 'bar' };
    expect(isValidProvider(plainObject)).toBe(false);
  });

  it('should return false for an object missing init method', () => {
    const invalidProvider = {
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false for an object missing asyncDispose method', () => {
    const invalidProvider = {
      init: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false for an object missing getAlertTasks method', () => {
    const invalidProvider = {
      init: async () => {},
      asyncDispose: async () => {},
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false for an object missing buildLogSearchLink method', () => {
    const invalidProvider = {
      init: async () => {},
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false for an object missing buildChartLink method', () => {
    const invalidProvider = {
      init: async () => {},
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false when methods are not functions', () => {
    const invalidProvider = {
      init: 'not a function',
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return false when multiple methods are not functions', () => {
    const invalidProvider = {
      init: 123,
      asyncDispose: 'dispose',
      getAlertTasks: null,
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
    };

    expect(isValidProvider(invalidProvider)).toBe(false);
  });

  it('should return true for a provider with additional properties', () => {
    const validProviderWithExtras = {
      init: async () => {},
      asyncDispose: async () => {},
      getAlertTasks: async () => [],
      buildLogSearchLink: () => 'http://example.com/search',
      buildChartLink: () => 'http://example.com/chart',
      updateAlertState: () => Promise.resolve(),
      getWebhooks: () => Promise.resolve(new Map()),
      extraProperty: 'should not affect validation',
      anotherMethod: () => {},
    };

    expect(isValidProvider(validProviderWithExtras)).toBe(true);
  });

  it('should return false for primitive values', () => {
    expect(isValidProvider('string')).toBe(false);
    expect(isValidProvider(123)).toBe(false);
    expect(isValidProvider(true)).toBe(false);
    expect(isValidProvider(false)).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isValidProvider([])).toBe(false);
    expect(isValidProvider([1, 2, 3])).toBe(false);
  });
});
