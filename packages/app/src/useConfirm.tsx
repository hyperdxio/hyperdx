import * as React from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

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
    <Modal show onHide={handleClose}>
      <Modal.Body className="bg-hdx-dark">
        {confirm.message}
        <div className="mt-3 d-flex justify-content-end gap-2">
          <Button variant="secondary" onClick={handleClose} size="sm">
            Cancel
          </Button>
          <Button variant="success" onClick={confirm.onConfirm} size="sm">
            {confirm.confirmLabel || 'OK'}
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  ) : null;
};
