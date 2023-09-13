import cx from 'classnames';
import { Button } from 'react-bootstrap';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { useState } from 'react';

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
        variant="link"
        className={cx('px-0 text-decoration-none fs-7', className)}
      >
        {children({ isCopied })}
      </Button>
    </CopyToClipboard>
  );
}
