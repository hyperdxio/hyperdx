import { useCallback, useState } from 'react';
import { Button, ButtonProps, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconLink } from '@tabler/icons-react';

import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';
import { buildShareUrl } from '@/utils/shareLink';

const COPIED_RESET_MS = 2000;

type ShareLinkButtonProps = {
  /**
   * Returns the query string (without a leading '?') to encode into the link.
   * Lets each page normalize state first (e.g. freeze the time range).
   */
  getShareSearch: () => string;
  label?: string;
} & ButtonProps;

/**
 * Copies a compact, self-contained shareable link for the current view to the
 * clipboard. The link collapses the whole query string into a single
 * compressed `?share=` token so it is far shorter than the raw URL.
 */
export default function ShareLinkButton({
  getShareSearch,
  label = 'Share',
  ...buttonProps
}: ShareLinkButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const url = await buildShareUrl(getShareSearch());
    const ok = await copyTextToClipboard(url);
    if (!ok) {
      notifications.show({ color: 'red', message: CLIPBOARD_ERROR_MESSAGE });
      return;
    }
    notifications.show({
      color: 'green',
      message: 'Copied shareable link to clipboard',
    });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
  }, [getShareSearch]);

  return (
    <Tooltip label="Copy a shareable link to this view" position="bottom">
      <Button
        data-testid="share-link-button"
        variant="secondary"
        size="xs"
        leftSection={
          isCopied ? <IconCheck size={14} /> : <IconLink size={14} />
        }
        style={{ flexShrink: 0 }}
        onClick={handleShare}
        {...buttonProps}
      >
        {isCopied ? 'Copied!' : label}
      </Button>
    </Tooltip>
  );
}
