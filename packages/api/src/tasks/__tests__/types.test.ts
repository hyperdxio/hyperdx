import { asTaskArgs } from '../types';

describe('asTaskArgs', () => {
  it('should return valid TaskArgs for valid input', () => {
    const validArgs = {
      _: ['command', 'arg1', 'arg2'],
      provider: 'default',
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'command',
      provider: 'default',
    });
    expect(result.taskName).toBe('command');
    expect(result.provider).toBe('default');
  });

  it('should return valid TaskArgs when provider is undefined', () => {
    const validArgs = {
      _: ['command'],
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'command',
      provider: undefined,
    });
    expect(result.taskName).toBe('command');
    expect(result.provider).toBeUndefined();
  });

  it('should throw error when provider is empty string', () => {
    const invalidArgs = {
      _: ['command'],
      provider: '',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must contain valid characters',
    );
  });

  it('should throw error for null input', () => {
    expect(() => asTaskArgs(null)).toThrow(
      'Arguments cannot be null or undefined',
    );
  });

  it('should throw error for undefined input', () => {
    expect(() => asTaskArgs(undefined)).toThrow(
      'Arguments cannot be null or undefined',
    );
  });

  it('should throw error for non-object input', () => {
    expect(() => asTaskArgs('string')).toThrow('Arguments must be an object');
    expect(() => asTaskArgs(123)).toThrow('Arguments must be an object');
    expect(() => asTaskArgs(true)).toThrow('Arguments must be an object');
    expect(() => asTaskArgs(false)).toThrow('Arguments must be an object');
    expect(() => asTaskArgs([])).toThrow('Arguments must be an object');
  });

  it('should throw error when _ property is missing', () => {
    const invalidArgs = {
      provider: 'default',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Arguments must have a "_" property that is an array',
    );
  });

  it('should throw error when _ property is not an array', () => {
    const invalidArgs = {
      _: 'not an array',
      provider: 'default',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Arguments must have a "_" property that is an array',
    );
  });

  it('should throw error when _ property is null', () => {
    const invalidArgs = {
      _: null,
      provider: 'default',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Arguments must have a "_" property that is an array',
    );
  });

  it('should throw error when provider is not a string', () => {
    const invalidArgs = {
      _: ['command'],
      provider: 123,
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must be a string if provided',
    );
  });

  it('should throw error when provider is null', () => {
    const invalidArgs = {
      _: ['command'],
      provider: null,
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must be a string if provided',
    );
  });

  it('should throw error when provider is an object', () => {
    const invalidArgs = {
      _: ['command'],
      provider: { name: 'default' },
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must be a string if provided',
    );
  });

  it('should throw error when provider is an array', () => {
    const invalidArgs = {
      _: ['command'],
      provider: ['default'],
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must be a string if provided',
    );
  });

  it('should handle empty array for _ property', () => {
    const validArgs = {
      _: [],
      provider: 'default',
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: undefined,
      provider: 'default',
    });
    expect(result.taskName).toBeUndefined();
  });

  it('should accept array with only strings for _ property', () => {
    const validArgs = {
      _: ['string', '123', 'true', 'null', 'undefined'],
      provider: 'default',
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'string',
      provider: 'default',
    });
    expect(result.taskName).toBe('string');
  });

  it('should extract taskName from first argument', () => {
    const validArgs = {
      _: ['command'],
      provider: 'default',
      extraProperty: 'value',
      anotherProperty: 123,
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'command',
      provider: 'default',
    });
    expect(result.taskName).toBe('command');
  });

  it('should require provider for check-alerts task', () => {
    const validArgs = {
      _: ['check-alerts'],
      provider: 'default',
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'check-alerts',
      provider: 'default',
    });
  });

  it('should throw error when check-alerts task has no provider', () => {
    const invalidArgs = {
      _: ['check-alerts'],
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider is required for check-alerts task',
    );
  });

  it('should throw error when check-alerts task has whitespace-only provider', () => {
    const invalidArgs = {
      _: ['check-alerts'],
      provider: '   ',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider is required for check-alerts task',
    );
  });

  it('should throw error when provider is whitespace-only', () => {
    const invalidArgs = {
      _: ['command'],
      provider: '   ',
    };

    expect(() => asTaskArgs(invalidArgs)).toThrow(
      'Provider must contain valid characters',
    );
  });
});
