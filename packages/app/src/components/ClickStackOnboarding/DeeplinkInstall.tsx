import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Anchor, Button, Collapse, Group, Stack, Tooltip } from '@mantine/core';

import { CopySnippet } from './CopySnippet';

interface DeeplinkInstallProps {
  buttonLabel: string;
  deeplink: string;
  fallbackLabel: string;
  fallbackSnippet: string;
  note?: ReactNode;
}

/**
 * One-click "Add to <host>" deep-link install for hosts that
 * support it (Cursor, VS Code + Copilot). The manual fallback
 * snippet stays tucked behind a `Manual setup` toggle so the
 * primary affordance is always the deep link, with the JSON
 * paste-it-yourself path available for users who can't or won't
 * use the deep link.
 */
export function DeeplinkInstall({
  buttonLabel,
  deeplink,
  fallbackLabel,
  fallbackSnippet,
  note,
}: DeeplinkInstallProps) {
  const { t } = useTranslation('onboarding');
  const [manualOpen, setManualOpen] = useState(false);
  return (
    <Stack gap="xs">
      <Group gap="sm" align="center">
        <Tooltip label={t('mcp.deeplinkTooltip')} withArrow>
          <Button component="a" href={deeplink} variant="primary">
            {buttonLabel}
          </Button>
        </Tooltip>
        <Anchor
          component="button"
          size="sm"
          onClick={() => setManualOpen(v => !v)}
        >
          {manualOpen ? t('mcp.hideManualSetup') : t('mcp.manualSetup')}
        </Anchor>
      </Group>
      {note}
      <Collapse expanded={manualOpen} transitionDuration={150}>
        <CopySnippet label={fallbackLabel} snippet={fallbackSnippet} />
      </Collapse>
    </Stack>
  );
}
