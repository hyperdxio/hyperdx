import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';
import ApiKeysSection from '@/components/TeamSettings/ApiKeysSection';
import { useConfirm } from '@/useConfirm';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
    useTeam: jest.fn(),
    useRotateTeamApiKey: jest.fn(),
    useRotatePersonalAccessKey: jest.fn(),
  },
  hdxServer: jest.fn(),
}));

// The real ConfirmProvider lives in pages/_app.tsx and pulls in next/router,
// so the shared dialog is mocked here and exercised in the E2E specs instead.
jest.mock('@/useConfirm', () => ({ useConfirm: jest.fn() }));

// Annotated as the loose `jest.Mock` rather than `jest.mocked(...)`'s exact
// MockedFunction: these hooks return TanStack `UseQueryResult` /
// `UseMutationResult` objects with ~25 members, and the tests only need the
// few the component reads. The loose type keeps `mockReturnValue` at `any`
// so the partial fixtures below need no type assertions.
const mockUseMe: jest.Mock = jest.mocked(api.useMe);
const mockUseTeam: jest.Mock = jest.mocked(api.useTeam);
const mockUseRotateTeamApiKey: jest.Mock = jest.mocked(api.useRotateTeamApiKey);
const mockUseRotatePersonalAccessKey: jest.Mock = jest.mocked(
  api.useRotatePersonalAccessKey,
);
const mockUseConfirm: jest.Mock = jest.mocked(useConfirm);

/** Options object the component hands to `mutate`, captured so the tests can
 *  drive `onSuccess` / `onError` without a real mutation. */
type MutateOptions = {
  onSuccess?: () => void;
  onError?: (e: Error) => void;
};

let capturedPersonalOptions: MutateOptions | undefined;
const rotatePersonalMutate = jest.fn(
  (_vars: undefined, options?: MutateOptions) => {
    capturedPersonalOptions = options;
  },
);
const rotateTeamMutate = jest.fn();

/** Resolution of the next `confirm(...)` call, i.e. did the user accept. */
let confirmAccepts = true;
// Params are declared so `mock.calls[n][i]` stays typed; the body ignores them.
const confirmSpy = jest.fn(
  (
    _message: ReactNode,
    _confirmLabel?: string,
    _options?: { variant?: 'primary' | 'danger' },
  ) => Promise.resolve(confirmAccepts),
);

function setMe(accessKey: string | null, isLoading = false) {
  mockUseMe.mockReturnValue({
    data:
      accessKey === null
        ? null
        : {
            id: 'u1',
            email: 'a@b.com',
            accessKey,
            name: 'User',
            createdAt: '',
          },
    isLoading,
  });
}

/** Renders the ReactNode the component passed to `confirm` so the dialog copy
 *  stays asserted even though the dialog itself is mocked out. */
function renderConfirmMessage(callIndex = 0) {
  const message = confirmSpy.mock.calls[callIndex][0];
  return render(<>{message}</>);
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedPersonalOptions = undefined;
  confirmAccepts = true;

  setMe('personal_key_abc');
  mockUseConfirm.mockReturnValue(confirmSpy);
  mockUseTeam.mockReturnValue({
    data: { apiKey: 'ingestion_key_xyz' },
    refetch: jest.fn(),
  });
  mockUseRotateTeamApiKey.mockReturnValue({ mutate: rotateTeamMutate });
  mockUseRotatePersonalAccessKey.mockReturnValue({
    mutate: rotatePersonalMutate,
  });
});

describe('ApiKeysSection', () => {
  // The two keys previously shared dataTestId="api-key" on an attribute
  // (`data-test-id`) that no test runner queries by default. Both getByTestId
  // calls below throw on duplicates, so this locks in the split.
  it('renders the ingestion and personal keys under distinct test ids', () => {
    renderWithMantine(<ApiKeysSection />);

    expect(screen.getByTestId('ingestion-api-key')).toHaveTextContent(
      'ingestion_key_xyz',
    );
    expect(screen.getByTestId('personal-access-key')).toHaveTextContent(
      'personal_key_abc',
    );
  });

  it('asks for a danger confirmation naming what the old key breaks', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-access-key-button'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][1]).toBe('Rotate key');
    expect(confirmSpy.mock.calls[0][2]).toEqual({ variant: 'danger' });

    const { container } = renderConfirmMessage();
    expect(container).toHaveTextContent(/not reversible/);
    expect(container).toHaveTextContent(/MCP \/ AI agent configs/);
    expect(container).toHaveTextContent(/stay signed in/);
  });

  it('does not rotate when the confirmation is declined', async () => {
    confirmAccepts = false;
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-access-key-button'));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(rotatePersonalMutate).not.toHaveBeenCalled();
  });

  it('rotates once when the confirmation is accepted', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-access-key-button'));

    await waitFor(() => expect(rotatePersonalMutate).toHaveBeenCalledTimes(1));
  });

  it('notifies on a successful rotation', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-access-key-button'));
    await waitFor(() => expect(rotatePersonalMutate).toHaveBeenCalled());
    capturedPersonalOptions?.onSuccess?.();

    expect(
      await screen.findByText(/Revoked your old personal access key/),
    ).toBeInTheDocument();
  });

  it('surfaces the error message when rotation fails', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-access-key-button'));
    await waitFor(() => expect(rotatePersonalMutate).toHaveBeenCalled());
    capturedPersonalOptions?.onError?.(new Error('rotate blew up'));

    expect(await screen.findByText('rotate blew up')).toBeInTheDocument();
  });

  it('confirms separately before rotating the ingestion key', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await user.click(screen.getByTestId('rotate-api-key-button'));

    await waitFor(() => expect(rotateTeamMutate).toHaveBeenCalledTimes(1));
    expect(rotatePersonalMutate).not.toHaveBeenCalled();
    const { container } = renderConfirmMessage();
    expect(container).toHaveTextContent(/invalidate your existing API key/);
  });

  it('renders neither the personal key nor its rotate button when me is null', () => {
    setMe(null);

    renderWithMantine(<ApiKeysSection />);

    expect(screen.queryByTestId('personal-access-key')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('rotate-access-key-button'),
    ).not.toBeInTheDocument();
    // The ingestion key is unaffected by the me payload.
    expect(screen.getByTestId('ingestion-api-key')).toBeInTheDocument();
  });
});
