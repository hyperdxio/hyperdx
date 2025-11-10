import { useState } from 'react';
import cx from 'classnames';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Button } from '@mantine/core';

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
      <Button
        variant="subtle"
        p={0}
        className={cx('text-decoration-none', className)}
        size="xs"
      >
        {children({ isCopied })}
      </Button>
    </CopyToClipboard>
  );
}
