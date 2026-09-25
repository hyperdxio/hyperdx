import {
  FieldErrors,
  UseFormHandleSubmit,
  UseFormTrigger,
} from 'react-hook-form';
import { Button } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';

import { useAlertPanel } from '@/components/AlertPanel';
import { ChartEditorFormState } from '@/components/ChartEditor/types';

/**
 * A `handleSubmit` error handler that opens the alert panel when the alert is
 * what failed validation, since its field errors render there.
 */
export function useShowAlertErrors() {
  const alertPanel = useAlertPanel();
  return (errors: FieldErrors<ChartEditorFormState>) => {
    if (errors.alert != null) {
      alertPanel?.open();
    }
  };
}

/**
 * The alert's primary action, shown under its inputs in the alert panel.
 * Where the alert saves on its own (the chart explorer) it saves it. Elsewhere
 * the alert saves with the chart, so this keeps the panel's changes (adding a
 * new alert, or updating an existing one) and closes the panel.
 */
export function AlertPanelPrimaryAction({
  trigger,
  handleSubmit,
  handleSaveAlert,
  saveAlertLabel = 'Save alert',
  isSavingAlert,
}: {
  trigger: UseFormTrigger<ChartEditorFormState>;
  handleSubmit: UseFormHandleSubmit<ChartEditorFormState>;
  handleSaveAlert?: (form: ChartEditorFormState) => void;
  saveAlertLabel?: string;
  isSavingAlert?: boolean;
}) {
  const alertPanel = useAlertPanel();
  const showAlertErrors = useShowAlertErrors();

  if (handleSaveAlert != null) {
    return (
      <Button
        fullWidth
        mt="md"
        variant="primary"
        leftSection={<IconBell size={16} />}
        loading={isSavingAlert}
        onClick={handleSubmit(handleSaveAlert, showAlertErrors)}
        data-testid="chart-save-alert-button"
      >
        {saveAlertLabel}
      </Button>
    );
  }

  return (
    <Button
      fullWidth
      mt="md"
      variant="primary"
      leftSection={<IconBell size={16} />}
      onClick={async () => {
        // Confirming shows the alert's field errors instead of closing on them.
        if (await trigger('alert')) {
          alertPanel?.confirm();
        }
      }}
      data-testid="alert-panel-confirm-button"
    >
      {alertPanel?.isDraft ? 'Add alert' : 'Update alert'}
    </Button>
  );
}
