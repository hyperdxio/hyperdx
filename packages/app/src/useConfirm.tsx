import * as React from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Modal } from '@mantine/core';

type ConfirmAtom = {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose?: () => void;
} | null;

const confirmAtom = atom<ConfirmAtom>(null);

export const useConfirm = () => {
  const setConfirm = useSetAtom(confirmAtom);

  return React.useCallback(
    async (message: string, confirmLabel?: string): Promise<boolean> => {
      return new Promise(resolve => {
        setConfirm({
          message,
          confirmLabel,
          onConfirm: () => {
            resolve(true);
            setConfirm(null);
          },
          onClose: () => {
            resolve(false);
            setConfirm(null);
          },
        });
      });
    },
    [setConfirm],
  );
};

export const useConfirmModal = () => {
  const confirm = useAtomValue(confirmAtom);
  const setConfirm = useSetAtom(confirmAtom);

  const handleClose = React.useCallback(() => {
    confirm?.onClose?.();
    setConfirm(null);
  }, [confirm, setConfirm]);

  return confirm ? (
    <Modal opened onClose={handleClose} title={confirm.message}>
      <div className="mt-3 d-flex justify-content-end gap-2">
        <Button onClick={handleClose} size="sm" variant="default">
          Cancel
        </Button>
        <Button onClick={confirm.onConfirm} size="sm" color="red">
          {confirm.confirmLabel || 'OK'}
        </Button>
      </div>
    </Modal>
  ) : null;
};
