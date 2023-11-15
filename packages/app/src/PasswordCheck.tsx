import { useMemo } from 'react';

const checkLength = (password: string) => password.length >= 12;
const checkOneUpper = (password: string) => /[A-Z]+/.test(password);
const checkOneLower = (password: string) => /[a-z]+/.test(password);
const checkOneNumber = (password: string) => /\d+/.test(password);
const checkOneSpecial = (password: string) => /\W+/.test(password);

export const PasswordCheck = (password: string | null) => {
  password = password ?? '';
  return (
    <ul>
      <li>
        <CheckOrX handler={checkLength} password={password}>
          minimum 12 characters
        </CheckOrX>
      </li>
      <li>
        <CheckOrX handler={checkOneUpper} password={password}>
          at least 1 uppercase
        </CheckOrX>
      </li>
      <li>
        <CheckOrX handler={checkOneLower} password={password}>
          at least 1 lowercase
        </CheckOrX>
      </li>
      <li>
        <CheckOrX handler={checkOneNumber} password={password}>
          at least 1 number
        </CheckOrX>
      </li>
      <li>
        <CheckOrX handler={checkOneSpecial} password={password}>
          at least 1 special character
        </CheckOrX>
      </li>
    </ul>
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
  const isValid = useMemo(
    () => handler(actualPassword),
    [handler, actualPassword],
  );
  return (
    <span className={isValid ? 'text-success' : 'text-danger'}>
      {isValid ? <Check /> : <XShape />} {children}
    </span>
  );
};

const Check = () => <i className={'bi bi-check2'}></i>;

const XShape = () => <i className={'bi bi-x'}></i>;
