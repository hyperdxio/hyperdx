import * as React from 'react';
import { useRouter } from 'next/router';
import { Button, Group, Modal, Text } from '@mantine/core';

type ConfirmOptions = {
  variant?: 'primary' | 'danger';
};

type ConfirmState = {
  message: React.ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose: () => void;
} | null;

type ConfirmFn = (
  message: React.ReactNode,
  confirmLabel?: string,
  options?: ConfirmOptions,
) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmState>(null);
  const router = useRouter();

  // Keep a ref so the route-change handler always sees the latest state
  // without needing to be re-registered on every render.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  React.useEffect(() => {
    const dismiss = () => {
      stateRef.current?.onClose();
    };
    router.events.on('routeChangeStart', dismiss);
    return () => router.events.off('routeChangeStart', dismiss);
  }, [router.events]);

  const confirm = React.useCallback<ConfirmFn>(
    (message, confirmLabel, options) => {
      return new Promise<boolean>(resolve => {
        setState({
          message,
          confirmLabel,
          confirmVariant: options?.variant ?? 'primary',
          onConfirm: () => {
            resolve(true);
            setState(null);
          },
          onClose: () => {
            resolve(false);
            setState(null);
          },
        });
      });
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        data-testid="confirm-modal"
        opened={!!state}
        onClose={state?.onClose ?? (() => {})}
        centered
        withCloseButton={false}
      >
        <Text size="sm" opacity={0.7}>
          {state?.message}
        </Text>
        <Group justify="flex-end" mt="md" gap="xs">
          <Button
            data-testid="confirm-cancel-button"
            size="xs"
            variant="secondary"
            onClick={state?.onClose}
          >
            Cancel
          </Button>
          <Button
            data-testid="confirm-confirm-button"
            size="xs"
            variant={state?.confirmVariant ?? 'primary'}
            onClick={state?.onConfirm}
          >
            {state?.confirmLabel || 'Confirm'}
          </Button>
        </Group>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => {
  const confirm = React.useContext(ConfirmContext);
  if (confirm == null) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return confirm;
};
