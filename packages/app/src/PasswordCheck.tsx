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

const Check = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="currentColor"
    className="bi bi-check2"
    viewBox="0 0 16 16"
  >
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

const XShape = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="currentColor"
    className="bi bi-x"
    viewBox="0 0 16 16"
  >
    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
  </svg>
);
