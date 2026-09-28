import { UseFormHandleSubmit } from 'react-hook-form';
import { SavedChartConfig } from '@hyperdx/common-utils/dist/types';
import { Button, Group } from '@mantine/core';

import { ChartEditorFormState } from '@/components/ChartEditor/types';

import { useShowAlertErrors } from './AlertPanelPrimaryAction';

/** The chart editor's Save and Cancel, each shown only when handled. */
export function ChartSaveActions({
  handleSubmit,
  handleSave,
  onSave,
  onClose,
  isSaving,
}: {
  handleSubmit: UseFormHandleSubmit<ChartEditorFormState>;
  handleSave: (form: ChartEditorFormState) => void;
  onSave?: (chart: SavedChartConfig) => void;
  onClose?: () => void;
  isSaving?: boolean;
}) {
  const showAlertErrors = useShowAlertErrors();

  if (onSave == null && onClose == null) return null;

  return (
    <Group gap="sm" wrap="nowrap">
      {onSave != null && (
        <Button
          data-testid="chart-save-button"
          loading={isSaving}
          variant="primary"
          onClick={handleSubmit(handleSave, showAlertErrors)}
        >
          Save
        </Button>
      )}
      {onClose != null && (
        <Button
          variant="subtle"
          color="dark"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </Button>
      )}
    </Group>
  );
}
