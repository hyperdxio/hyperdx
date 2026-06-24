import * as validators from '@/utils/validators';

describe('validators', () => {
  describe('validatePassword', () => {
    it('should return true if password is valid', () => {
      expect(validators.validatePassword('aB3!efghijkl')).toBe(true);
      expect(validators.validatePassword('ValidPass123!')).toBe(true);
    });

    it('should return false if password is invalid', () => {
      expect(validators.validatePassword(null as any)).toBe(false);
      expect(validators.validatePassword(undefined as any)).toBe(false);
      expect(validators.validatePassword('')).toBe(false);
      expect(validators.validatePassword('1234567')).toBe(false);
      expect(validators.validatePassword('abcdefghijk')).toBe(false); // 11 chars
      expect(validators.validatePassword('abcdefghijkl')).toBe(false); // no upper/num/special
      expect(validators.validatePassword('ABCDEFGHIJKL')).toBe(false); // no lower/num/special
      expect(validators.validatePassword('Abcdefghijkl')).toBe(false); // no num/special
      expect(validators.validatePassword('Abcdefghijk1')).toBe(false); // no special
      expect(validators.validatePassword('Abcdefghijk!')).toBe(false); // no num
      expect(validators.validatePassword('ValidPass123!'.repeat(6))).toBe(
        false,
      ); // 78 chars (over 72)
    });
  });
});
