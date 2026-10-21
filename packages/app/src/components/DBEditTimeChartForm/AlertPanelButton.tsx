import { Button, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconBell } from '@tabler/icons-react';

import { useAlertPanel } from '@/components/AlertPanel';

/**
 * Opens the chart editor's alert panel, adding a draft alert first when the
 * chart has none. Reads "Edit alert" once the chart has a confirmed alert.
 */
export function AlertPanelButton({
  hasAlert,
  onAddAlert,
  error,
  warning,
}: {
  hasAlert: boolean;
  onAddAlert: () => void;
  /**
   * The alert's error and warning. Their badges render in the panel, which an
   * existing alert opens closed, so the button carries them while it is.
   */
  error?: string;
  warning?: string;
}) {
  const alertPanel = useAlertPanel();
  const isConfirmed = hasAlert && !alertPanel?.isDraft;
  const issue =
    hasAlert && !alertPanel?.opened ? (error ?? warning) : undefined;

  return (
    <Tooltip
      label={issue}
      disabled={issue == null}
      withArrow
      multiline
      maw={400}
    >
      <Button
        variant="subtle"
        size="sm"
        onClick={() => {
          if (hasAlert) {
            // Only opens: closing from here would cancel the panel's changes
            // without the user asking to.
            alertPanel?.open();
            return;
          }
          onAddAlert();
          alertPanel?.openDraft();
        }}
        aria-expanded={hasAlert ? alertPanel?.opened : undefined}
        data-testid="alert-button"
      >
        {issue != null ? (
          <IconAlertTriangle
            size={14}
            className="me-2"
            color={
              error != null
                ? 'var(--color-text-danger)'
                : 'var(--color-text-warning)'
            }
            data-testid="alert-button-issue-icon"
          />
        ) : (
          <IconBell size={14} className="me-2" />
        )}
        {isConfirmed ? 'Edit alert' : 'Add alert'}
      </Button>
    </Tooltip>
  );
}
