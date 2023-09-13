import * as validators from '../validators';

describe('validators', () => {
  describe('validatePassword', () => {
    it('should return true if password is valid', () => {
      expect(validators.validatePassword('abcdefgh')).toBe(true);
    });

    it('should return false if password is invalid', () => {
      expect(validators.validatePassword(null)).toBe(false);
      expect(validators.validatePassword(undefined)).toBe(false);
      expect(validators.validatePassword('')).toBe(false);
      expect(validators.validatePassword('1234567')).toBe(false);
      expect(validators.validatePassword('a'.repeat(65))).toBe(false);
    });
  });
});
