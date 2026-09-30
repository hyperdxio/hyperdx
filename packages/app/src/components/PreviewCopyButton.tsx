import { useState } from 'react';
import CopyToClipboard from 'react-copy-to-clipboard';
import { Button } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

/**
 * The Copy/Copied! button the read-only query previews overlay on their
 * top-right corner. Positioned absolutely, so it expects a positioned ancestor.
 */
export default function PreviewCopyButton({
  text = '',
  size = 'md',
}: {
  text?: string;
  size?: 'xs' | 'md';
}) {
  const [copied, setCopied] = useState(false);

  const iconSize = size === 'xs' ? 14 : 16;
  const buttonSize = size === 'xs' ? 'compact-xs' : 'sm';

  return (
    <CopyToClipboard text={text ?? ''} onCopy={() => setCopied(true)}>
      <Button
        variant={copied ? 'light' : 'default'}
        size={buttonSize}
        className="position-absolute top-0 end-0"
      >
        {copied ? (
          <IconCheck size={iconSize} className="me-2" />
        ) : (
          <IconCopy size={iconSize} className="me-2" />
        )}
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </CopyToClipboard>
  );
}
