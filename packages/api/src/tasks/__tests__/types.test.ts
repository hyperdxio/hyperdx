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
    // For non-check-alerts tasks, we need to use type assertion to access provider
    expect((result as any).provider).toBe('default');
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
    // For non-check-alerts tasks, we need to use type assertion to access provider
    expect((result as any).provider).toBeUndefined();
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

  it('should accept check-alerts task with provider', () => {
    const validArgs = {
      _: ['check-alerts'],
      provider: 'default',
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'check-alerts',
      provider: 'default',
    });
    expect(result.taskName).toBe('check-alerts');
    // For check-alerts tasks, provider property is directly accessible
    if (result.taskName === 'check-alerts') {
      expect(result.provider).toBe('default');
    }
  });

  it('should accept check-alerts task without provider', () => {
    const validArgs = {
      _: ['check-alerts'],
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'check-alerts',
      provider: undefined,
    });
    expect(result.taskName).toBe('check-alerts');
    // For check-alerts tasks, provider property is directly accessible
    if (result.taskName === 'check-alerts') {
      expect(result.provider).toBeUndefined();
    }
  });

  it('should accept ping-pong task without provider', () => {
    const validArgs = {
      _: ['ping-pong'],
    };

    const result = asTaskArgs(validArgs);

    expect(result).toEqual({
      taskName: 'ping-pong',
    });
    expect(result.taskName).toBe('ping-pong');
    // Ping-pong tasks should not have a provider property
    expect('provider' in result).toBe(false);
  });

  describe('concurrency parameter validation', () => {
    it('should accept check-alerts task with valid concurrency', () => {
      const validArgs = {
        _: ['check-alerts'],
        concurrency: 4,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: undefined,
        concurrency: 4,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.concurrency).toBe(4);
      }
    });

    it('should accept check-alerts task with concurrency value of 1', () => {
      const validArgs = {
        _: ['check-alerts'],
        concurrency: 1,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: undefined,
        concurrency: 1,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.concurrency).toBe(1);
      }
    });

    it('should accept check-alerts task with large concurrency values', () => {
      const validArgs = {
        _: ['check-alerts'],
        concurrency: 100,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: undefined,
        concurrency: 100,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.concurrency).toBe(100);
      }
    });

    it('should accept check-alerts task without concurrency parameter', () => {
      const validArgs = {
        _: ['check-alerts'],
        provider: 'default',
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: 'default',
        concurrency: undefined,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.concurrency).toBeUndefined();
      }
    });

    it('should throw error when concurrency is not a number', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 'invalid',
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be a number if provided',
      );
    });

    it('should throw error when concurrency is boolean', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: true,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be a number if provided',
      );
    });

    it('should throw error when concurrency is null', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: null,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be a number if provided',
      );
    });

    it('should throw error when concurrency is an object', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: { value: 4 },
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be a number if provided',
      );
    });

    it('should throw error when concurrency is an array', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: [4],
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be a number if provided',
      );
    });

    it('should throw error when concurrency is zero', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 0,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency cannot be less than 1',
      );
    });

    it('should throw error when concurrency is negative', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: -1,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency cannot be less than 1',
      );
    });

    it('should throw error when concurrency is a negative decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: -0.5,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be an integer if provided',
      );
    });

    it('should throw error when concurrency is a positive decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 2.5,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be an integer if provided',
      );
    });

    it('should throw error when concurrency is a small decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 1.1,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be an integer if provided',
      );
    });

    it('should throw error when concurrency is a large decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 100.999,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'Concurrency must be an integer if provided',
      );
    });

    it('should ignore concurrency parameter for non-check-alerts tasks', () => {
      const validArgs = {
        _: ['ping-pong'],
        concurrency: 4,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'ping-pong',
      });
      expect(result.taskName).toBe('ping-pong');
      // Ping-pong tasks should not have a concurrency property
      expect('concurrency' in result).toBe(false);
    });

    it('should ignore concurrency parameter for unknown task types', () => {
      const validArgs = {
        _: ['unknown-task'],
        concurrency: 4,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'unknown-task',
        provider: undefined,
      });
      expect(result.taskName).toBe('unknown-task');
      // Unknown task types should not process concurrency parameter
      expect('concurrency' in result).toBe(false);
    });
  });
});
