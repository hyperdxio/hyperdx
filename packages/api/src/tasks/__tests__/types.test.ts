import { asTaskArgs } from '../types';

describe('asTaskArgs', () => {
  describe('invalid inputs', () => {
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

    it('should throw error when _ is empty', () => {
      const validArgs = {
        _: [],
        provider: 'default',
      };

      expect(() => asTaskArgs(validArgs)).toThrow(
        'Task name needs to be specified',
      );
    });
  });

  describe('check-alerts task', () => {
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

    it('should accept check-alerts task with a concurrency value', () => {
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

    it('should throw error when concurrency is not a number', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 'invalid',
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow('Expected number');
    });

    it('should throw error when concurrency is zero', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 0,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'concurrency must be at least 1',
      );
    });

    it('should throw error when concurrency is negative', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: -1,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'concurrency must be at least 1',
      );
    });

    it('should throw error when concurrency is a positive decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        concurrency: 2.5,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'concurrency must be an integer',
      );
    });

    it('should accept check-alerts task with valid sourceTimeoutMs', () => {
      const validArgs = {
        _: ['check-alerts'],
        sourceTimeoutMs: 5000,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: undefined,
        concurrency: undefined,
        sourceTimeoutMs: 5000,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.sourceTimeoutMs).toBe(5000);
      }
    });

    it('should accept check-alerts task with sourceTimeoutMs of 0', () => {
      const validArgs = {
        _: ['check-alerts'],
        sourceTimeoutMs: 0,
      };

      const result = asTaskArgs(validArgs);

      expect(result).toEqual({
        taskName: 'check-alerts',
        provider: undefined,
        concurrency: undefined,
        sourceTimeoutMs: 0,
      });
      expect(result.taskName).toBe('check-alerts');
      if (result.taskName === 'check-alerts') {
        expect(result.sourceTimeoutMs).toBe(0);
      }
    });

    it('should throw error when sourceTimeoutMs is not a number', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        sourceTimeoutMs: 'invalid',
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow('Expected number');
    });

    it('should throw error when sourceTimeoutMs is negative', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        sourceTimeoutMs: -1,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'sourceTimeoutMs must be a non-negative value',
      );
    });

    it('should throw error when sourceTimeoutMs is a small decimal', () => {
      const invalidArgs = {
        _: ['check-alerts'],
        sourceTimeoutMs: 1.1,
      };

      expect(() => asTaskArgs(invalidArgs)).toThrow(
        'sourceTimeoutMs must be an int',
      );
    });
  });

  describe('ping-pong task', () => {
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
  });
});
