import { ReactNode, useState } from 'react';
import { Anchor, Button, Collapse, Group, Stack, Tooltip } from '@mantine/core';

import { CopySnippet } from './CopySnippet';

interface DeeplinkInstallProps {
  buttonLabel: string;
  deeplink: string;
  fallbackLabel: string;
  fallbackSnippet: string;
  /** Access key to mask in the fallback snippet (the deep link isn't shown). */
  fallbackAccessKey?: string;
  note?: ReactNode;
}

/**
 * One-click "Add to <host>" deep-link install (Cursor, VS Code), with a
 * manual JSON fallback behind a `Manual setup` toggle.
 */
export function DeeplinkInstall({
  buttonLabel,
  deeplink,
  fallbackLabel,
  fallbackSnippet,
  fallbackAccessKey,
  note,
}: DeeplinkInstallProps) {
  const [manualOpen, setManualOpen] = useState(false);
  return (
    <Stack gap="xs">
      <Group gap="sm" align="center">
        <Tooltip
          label="Opens the host with the server pre-configured"
          withArrow
        >
          <Button component="a" href={deeplink} variant="primary">
            {buttonLabel}
          </Button>
        </Tooltip>
        <Anchor
          component="button"
          size="sm"
          onClick={() => setManualOpen(v => !v)}
        >
          {manualOpen ? 'Hide manual setup' : 'Manual setup'}
        </Anchor>
      </Group>
      {note}
      <Collapse expanded={manualOpen} transitionDuration={150}>
        <CopySnippet
          label={fallbackLabel}
          snippet={fallbackSnippet}
          accessKey={fallbackAccessKey}
        />
      </Collapse>
    </Stack>
  );
}
