function extractDomainFromUrl(url: string): string {
  const hostname = new URL(url).hostname;
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidSlackUrl(url: string): boolean {
  return isValidUrl(url) && extractDomainFromUrl(url) === 'slack.com';
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

// The set of special characters accepted by the password policy. This is the
// single source of truth shared between the backend `passwordSchema`
// (packages/api) and the frontend `PasswordCheck` checklist (packages/app) so
// the requirements shown to users always match what the server enforces.
export const PASSWORD_SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>;\-+=]/;

// Human-readable list of the accepted special characters, kept in sync with
// PASSWORD_SPECIAL_CHAR_REGEX. Used in validation error messages so users know
// exactly which characters count (e.g. `~`, a backtick, or a space do not).
export const PASSWORD_SPECIAL_CHARS = '!@#$%^&*(),.?":{}|<>;-+=';

export const passwordValidators = {
  hasMinLength: (password: string) => password.length >= PASSWORD_MIN_LENGTH,
  hasMaxLength: (password: string) => password.length <= PASSWORD_MAX_LENGTH,
  hasUpperCase: (password: string) => /[A-Z]/.test(password),
  hasLowerCase: (password: string) => /[a-z]/.test(password),
  hasNumber: (password: string) => /\d/.test(password),
  hasSpecialChar: (password: string) =>
    PASSWORD_SPECIAL_CHAR_REGEX.test(password),
};
