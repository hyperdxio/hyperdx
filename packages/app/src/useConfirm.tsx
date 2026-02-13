import * as React from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Group, Modal, Text } from '@mantine/core';

type ConfirmOptions = {
  variant?: 'primary' | 'danger';
};

type ConfirmAtom = {
  message: React.ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose?: () => void;
} | null;

const confirmAtom = atom<ConfirmAtom>(null);

export const useConfirm = () => {
  const setConfirm = useSetAtom(confirmAtom);

  return React.useCallback(
    async (
      message: React.ReactNode,
      confirmLabel?: string,
      options?: ConfirmOptions,
    ): Promise<boolean> => {
      return new Promise(resolve => {
        setConfirm({
          message,
          confirmLabel,
          confirmVariant: options?.variant ?? 'primary',
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

  return (
    <Modal
      data-testid="confirm-modal"
      opened={!!confirm}
      onClose={handleClose}
      centered
      withCloseButton={false}
    >
      <Text size="sm" opacity={0.7}>
        {confirm?.message}
      </Text>
      <Group justify="flex-end" mt="md" gap="xs">
        <Button
          data-testid="confirm-cancel-button"
          size="xs"
          variant="secondary"
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button
          data-testid="confirm-confirm-button"
          size="xs"
          variant={confirm?.confirmVariant ?? 'primary'}
          onClick={confirm?.onConfirm}
        >
          {confirm?.confirmLabel || 'Confirm'}
        </Button>
      </Group>
    </Modal>
  );
};
