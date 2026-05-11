import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@mantine/core';

import EditTimeChartForm from '@/components/DBEditTimeChartForm';
import { type Tile } from '@/dashboard';
import { useConfirm } from '@/useConfirm';
import { useZIndex, ZIndexContext } from '@/zIndex';

type EditTileModalProps = {
  dashboardId?: string;
  chart: Tile | undefined;
  onClose: () => void;
  dateRange: [Date, Date];
  isSaving?: boolean;
  onSave: (chart: Tile) => void;
};

export function EditTileModal({
  dashboardId,
  chart,
  onClose,
  onSave,
  isSaving,
  dateRange,
}: EditTileModalProps) {
  const contextZIndex = useZIndex();
  const modalZIndex = contextZIndex + 10;
  const confirm = useConfirm();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (chart != null) {
      setHasUnsavedChanges(false);
    }
  }, [chart]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    if (hasUnsavedChanges) {
      confirm(
        'You have unsaved changes. Discard them and close the editor?',
        'Discard',
      ).then(ok => {
        if (ok) {
          // Reset dirty state before closing so any re-invocation of
          // handleClose (e.g. from Mantine focus management after the
          // confirm modal closes) doesn't re-show the confirm dialog.
          setHasUnsavedChanges(false);
          onClose();
        }
      });
    } else {
      onClose();
    }
  }, [confirm, isSaving, hasUnsavedChanges, onClose]);

  return (
    <Modal
      opened={chart != null}
      onClose={handleClose}
      withCloseButton={false}
      centered
      size="90%"
      padding="xs"
      zIndex={modalZIndex}
    >
      {chart != null && (
        <ZIndexContext.Provider value={modalZIndex + 10}>
          <EditTimeChartForm
            dashboardId={dashboardId}
            chartConfig={chart.config}
            dateRange={dateRange}
            isSaving={isSaving}
            onSave={config => {
              onSave({
                ...chart,
                config: config,
              });
            }}
            onClose={handleClose}
            onDirtyChange={setHasUnsavedChanges}
            isDashboardForm
            autoRun
          />
        </ZIndexContext.Provider>
      )}
    </Modal>
  );
}
