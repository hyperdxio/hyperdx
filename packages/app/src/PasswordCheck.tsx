import { useEffect, useState } from 'react';

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
  password: string;
  children: React.ReactNode;
}) => {
  const [isValid, setIsValid] = useState(false);
  useEffect(() => {
    const actualPass = (password['password'] as string) ?? password;
    setIsValid(handler(actualPass));
  }, [handler, password]);
  return (
    <span className={isValid ? 'text-success' : 'text-danger'}>
      {isValid ? <Check /> : <XShape />} {children}
    </span>
  );
};

const Check = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    className="bi bi-check2"
    viewBox="0 0 16 16"
  >
    <path
      fillRule="evenodd"
      d="M13.854 3.146a.5.5 0 010 .708l-8 8a.5.5 0 01-.708 0l-4-4a.5.5 0 11.708-.708L5
      10.293l8-8a.5.5 0 01.708 0z"
      clipRule="evenodd"
    />
  </svg>
);

const XShape = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="currentColor"
    className="bi bi-x"
    viewBox="0 0 16 16"
  >
    <path
      fillRule="evenodd"
      d="M1.146 1.146a.5.5 0 01.708 0L8
      7.293l6.146-6.147a.5.5 0 01.708.708L8.707
      8l6.147 6.146a.5.5 0 01-.708.708L8 8.707l-6.146
      6.147a.5.5 0 01-.708-.708L7.293 8 .146 1.146z"
      clipRule="evenodd"
      stroke="currentColor"
      stroke-width="1"
    />
  </svg>
);
