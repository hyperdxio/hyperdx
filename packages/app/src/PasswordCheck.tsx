import { useMemo } from 'react';
import {
  PASSWORD_MIN_LENGTH,
  passwordValidators,
} from '@hyperdx/common-utils/dist/validation';
import { IconCheck, IconX } from '@tabler/icons-react';

const checkLength = passwordValidators.hasMinLength;
const checkOneUpper = passwordValidators.hasUpperCase;
const checkOneLower = passwordValidators.hasLowerCase;
const checkOneNumber = passwordValidators.hasNumber;
const checkOneSpecial = passwordValidators.hasSpecialChar;

export const PasswordCheck = (opts: { password: string }) => {
  const password = opts.password;
  return (
    <div>
      <div>
        <CheckOrX handler={checkLength} password={password}>
          minimum {PASSWORD_MIN_LENGTH} characters
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneUpper} password={password}>
          at least 1 uppercase
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneLower} password={password}>
          at least 1 lowercase
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneNumber} password={password}>
          at least 1 number
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneSpecial} password={password}>
          at least 1 special character
        </CheckOrX>
      </div>
    </div>
  );
};

export const CheckOrX = ({
  handler,
  password,
  children,
}: {
  handler: (password: string) => boolean;
  password: string | { password: string | null };
  children: React.ReactNode;
}) => {
  let actualPassword = '';
  if (typeof password === 'string') {
    actualPassword = password;
  } else {
    actualPassword = password.password ?? '';
  }
  const isEmpty = actualPassword.length === 0;
  const isValid = useMemo(
    () => handler(actualPassword),
    [handler, actualPassword],
  );

  if (isEmpty) {
    return <span>{children}</span>;
  }

  return (
    <span className={isValid ? 'text-success' : 'text-danger'}>
      {isValid ? <Check /> : <XShape />} {children}
    </span>
  );
};

const Check = () => <IconCheck size={14} />;

const XShape = () => <IconX size={14} />;
