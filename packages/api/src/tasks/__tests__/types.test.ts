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
