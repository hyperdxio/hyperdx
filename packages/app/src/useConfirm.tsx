import * as React from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { Button, Group, Modal, Text } from '@mantine/core';

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

  return (
    <Modal
      opened={!!confirm}
      onClose={handleClose}
      centered
      withCloseButton={false}
    >
      <Text size="sm" opacity={0.7}>
        {confirm?.message}
      </Text>
      <Group justify="flex-end" mt="md" gap="xs">
        <Button size="xs" variant="outline" onClick={handleClose} color="Gray">
          Cancel
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={confirm?.onConfirm}
          color="red"
        >
          {confirm?.confirmLabel || 'Confirm'}
        </Button>
      </Group>
    </Modal>
  );
};
