import { useState } from 'react';
import cx from 'classnames';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { UnstyledButton } from '@mantine/core';

export default function Clipboard({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ({ isCopied }: { isCopied: boolean }) => React.ReactNode;
}) {
  const [isCopied, setIsCopied] = useState(false);

  return (
    <CopyToClipboard
      text={text}
      onCopy={() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }}
    >
      <UnstyledButton variant="transparent" className={cx('fs-7', className)}>
        {children({ isCopied })}
      </UnstyledButton>
    </CopyToClipboard>
  );
}
