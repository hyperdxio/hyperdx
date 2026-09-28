import { Button } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';

import { useAlertPanel } from '@/components/AlertPanel';

/**
 * Opens the chart editor's alert panel, adding a draft alert first when the
 * chart has none. Reads "Edit alert" once the chart has a confirmed alert.
 */
export function AlertPanelButton({
  hasAlert,
  onAddAlert,
}: {
  hasAlert: boolean;
  onAddAlert: () => void;
}) {
  const alertPanel = useAlertPanel();
  const isConfirmed = hasAlert && !alertPanel?.isDraft;

  return (
    <Button
      variant="subtle"
      size="sm"
      color="gray"
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
      <IconBell size={14} className="me-2" />
      {isConfirmed ? 'Edit alert' : 'Add alert'}
    </Button>
  );
}
