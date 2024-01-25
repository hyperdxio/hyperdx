import { useMemo } from 'react';

const checkLength = (password: string) => password.length >= 12;
const checkOneUpper = (password: string) => /[A-Z]+/.test(password);
const checkOneLower = (password: string) => /[a-z]+/.test(password);
const checkOneNumber = (password: string) => /\d+/.test(password);
const checkOneSpecial = (password: string) => /\W+/.test(password);

export const PasswordCheck = (opts: { password: string }) => {
  const password = opts.password;
  return (
    <div>
      <div>
        <CheckOrX handler={checkLength} password={password}>
          minimum 12 characters
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

const Check = () => <i className={'bi bi-check2'}></i>;

const XShape = () => <i className={'bi bi-x'}></i>;
