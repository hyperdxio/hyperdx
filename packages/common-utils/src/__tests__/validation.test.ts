import {
  isValidSlackUrl,
  isValidUrl,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordValidators,
} from '@/validation';

describe('validation', () => {
  it.each([
    ['https://slack.com', true],
    ['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXX', true],
    ['https://google.com', false],
    ['google.com', false],
    ['12312be127eb192ub', false],
  ])('isValidSlackUrl(%s) = %s', (url, expected) => {
    expect(isValidSlackUrl(url)).toBe(expected);
  });

  it.each([
    ['https://slack.com', true],
    ['https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXX', true],
    ['https://google.com', true],
    ['google.com', false],
    ['12312be127eb192ub', false],
  ])('isValidUrl(%s) = %s', (url, expected) => {
    expect(isValidUrl(url)).toBe(expected);
  });

  describe('passwordValidators.hasSpecialChar', () => {
    it.each(['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', ',', '.', '?'])(
      'accepts allowed special character "%s"',
      char => {
        expect(passwordValidators.hasSpecialChar(char)).toBe(true);
      },
    );

    it.each([':', '"', '{', '}', '|', '<', '>', ';', '-', '+', '='])(
      'accepts allowed special character "%s"',
      char => {
        expect(passwordValidators.hasSpecialChar(char)).toBe(true);
      },
    );

    // These characters match the loose /\W+/ pattern the checklist used to use,
    // but the backend passwordSchema rejects them. The shared validator must
    // reject them too so the checklist never shows a green check for a password
    // the server will refuse.
    it.each(['~', '`', ' ', '_', '/', '\\', '[', ']', "'"])(
      'rejects disallowed character "%s"',
      char => {
        expect(passwordValidators.hasSpecialChar(char)).toBe(false);
      },
    );

    it('rejects a password with no special character', () => {
      expect(passwordValidators.hasSpecialChar('abcDEF123')).toBe(false);
    });
  });

  describe('passwordValidators length checks', () => {
    it('enforces the minimum length', () => {
      expect(
        passwordValidators.hasMinLength('a'.repeat(PASSWORD_MIN_LENGTH)),
      ).toBe(true);
      expect(
        passwordValidators.hasMinLength('a'.repeat(PASSWORD_MIN_LENGTH - 1)),
      ).toBe(false);
    });

    it('enforces the maximum length', () => {
      expect(
        passwordValidators.hasMaxLength('a'.repeat(PASSWORD_MAX_LENGTH)),
      ).toBe(true);
      expect(
        passwordValidators.hasMaxLength('a'.repeat(PASSWORD_MAX_LENGTH + 1)),
      ).toBe(false);
    });
  });

  describe('passwordValidators character-class checks', () => {
    it('detects upper, lower and number', () => {
      expect(passwordValidators.hasUpperCase('abc')).toBe(false);
      expect(passwordValidators.hasUpperCase('Abc')).toBe(true);
      expect(passwordValidators.hasLowerCase('ABC')).toBe(false);
      expect(passwordValidators.hasLowerCase('aBC')).toBe(true);
      expect(passwordValidators.hasNumber('abc')).toBe(false);
      expect(passwordValidators.hasNumber('abc1')).toBe(true);
    });
  });
});
