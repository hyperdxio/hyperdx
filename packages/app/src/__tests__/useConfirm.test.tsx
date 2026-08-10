import { fireEvent, screen } from '@testing-library/react';

import { ConfirmProvider, useConfirm } from '@/useConfirm';

const mockRouterEvents = {
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock('next/router', () => ({
  useRouter: () => ({ events: mockRouterEvents }),
}));

function ConfirmTrigger({
  onResult,
}: {
  onResult: (result: Promise<boolean>) => void;
}) {
  const confirm = useConfirm();

  return (
    <button
      onClick={() =>
        onResult(
          confirm('Delete this dashboard?', 'Delete dashboard', {
            variant: 'danger',
          }),
        )
      }
    >
      Open confirmation
    </button>
  );
}

describe('ConfirmProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['cancel', 'confirm-cancel-button', false],
    ['confirm', 'confirm-confirm-button', true],
  ])(
    'preserves destructive content during the close transition after %s',
    async (_, actionTestId, expectedResult) => {
      let result: Promise<boolean> | undefined;

      renderWithMantine(
        <ConfirmProvider>
          <ConfirmTrigger onResult={value => (result = value)} />
        </ConfirmProvider>,
      );

      fireEvent.click(
        screen.getByRole('button', { name: 'Open confirmation' }),
      );

      const confirmButton = await screen.findByTestId('confirm-confirm-button');
      expect(confirmButton).toHaveTextContent('Delete dashboard');
      expect(confirmButton).toHaveAttribute('data-variant', 'danger');

      fireEvent.click(screen.getByTestId(actionTestId));

      await expect(result).resolves.toBe(expectedResult);
      expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent(
        'Delete dashboard',
      );
      expect(screen.getByTestId('confirm-confirm-button')).toHaveAttribute(
        'data-variant',
        'danger',
      );
    },
  );
});
