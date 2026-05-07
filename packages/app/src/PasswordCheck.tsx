import { useMemo } from 'react';
import { Trans } from 'next-i18next/pages';
import { IconCheck, IconX } from '@tabler/icons-react';

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
          <Trans>minimum 12 characters</Trans>
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneUpper} password={password}>
          <Trans>at least 1 uppercase</Trans>
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneLower} password={password}>
          <Trans>at least 1 lowercase</Trans>
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneNumber} password={password}>
          <Trans>at least 1 number</Trans>
        </CheckOrX>
      </div>
      <div>
        <CheckOrX handler={checkOneSpecial} password={password}>
          <Trans>at least 1 special character</Trans>
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
