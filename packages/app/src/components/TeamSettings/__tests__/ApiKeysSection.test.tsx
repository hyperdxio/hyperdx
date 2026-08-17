import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';
import ApiKeysSection from '@/components/TeamSettings/ApiKeysSection';

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

// Annotated as the loose `jest.Mock` rather than `jest.mocked(...)`'s exact
// MockedFunction: these hooks return TanStack `UseQueryResult` /
// `UseMutationResult` objects with ~25 members, and the tests only need the
// three the component reads. The loose type keeps `mockReturnValue` at `any`
// so the partial fixtures below need no type assertions.
const mockUseMe: jest.Mock = jest.mocked(api.useMe);
const mockUseTeam: jest.Mock = jest.mocked(api.useTeam);
const mockUseRotateTeamApiKey: jest.Mock = jest.mocked(api.useRotateTeamApiKey);
const mockUseRotatePersonalAccessKey: jest.Mock = jest.mocked(
  api.useRotatePersonalAccessKey,
);

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

const PERSONAL_MODAL_COPY = /Rotating your personal access key/;

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

/**
 * Mantine mounts modal content one tick after `opened` flips, so every
 * open-the-modal step has to await the content rather than the modal root —
 * the root stays in the DOM (empty) the whole time.
 */
async function openPersonalRotateModal(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByTestId('rotate-access-key-button'));
  await screen.findByText(PERSONAL_MODAL_COPY);
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedPersonalOptions = undefined;

  setMe('personal_key_abc');
  mockUseTeam.mockReturnValue({
    data: { apiKey: 'ingestion_key_xyz' },
    refetch: jest.fn(),
  });
  mockUseRotateTeamApiKey.mockReturnValue({ mutate: jest.fn() });
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

  it('opens the personal rotate modal with the breakage warning', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);

    const modal = screen.getByTestId('rotate-access-key-modal');
    expect(modal).toHaveTextContent(/not reversible/);
    expect(modal).toHaveTextContent(/MCP/);
    expect(modal).toHaveTextContent(/stay signed in/);
    // The ingestion modal must not have opened alongside it.
    expect(
      screen.queryByText(/Rotating the API key will invalidate/),
    ).not.toBeInTheDocument();
  });

  it('closes the personal rotate modal on cancel without mutating', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);
    await user.click(screen.getByTestId('rotate-access-key-cancel'));

    expect(rotatePersonalMutate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText(PERSONAL_MODAL_COPY)).not.toBeInTheDocument(),
    );
  });

  it('rotates once on confirm and closes the modal', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);
    await user.click(screen.getByTestId('rotate-access-key-confirm'));

    expect(rotatePersonalMutate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(PERSONAL_MODAL_COPY)).not.toBeInTheDocument(),
    );
  });

  // The modal closes on confirm, but Mantine keeps its content mounted through
  // the exit transition, so without this guard a fast double click fires two
  // PATCHes and the second revokes the key the first just generated.
  it('disables confirm while a rotation is already in flight', async () => {
    mockUseRotatePersonalAccessKey.mockReturnValue({
      mutate: rotatePersonalMutate,
      isPending: true,
    });
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);
    const confirm = screen.getByTestId('rotate-access-key-confirm');
    expect(confirm).toBeDisabled();

    await user.click(confirm);
    expect(rotatePersonalMutate).not.toHaveBeenCalled();
  });

  it('notifies on a successful rotation', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);
    await user.click(screen.getByTestId('rotate-access-key-confirm'));
    act(() => capturedPersonalOptions?.onSuccess?.());

    expect(
      await screen.findByText(/Revoked your old personal access key/),
    ).toBeInTheDocument();
  });

  it('surfaces the error message when rotation fails', async () => {
    const user = userEvent.setup();
    renderWithMantine(<ApiKeysSection />);

    await openPersonalRotateModal(user);
    await user.click(screen.getByTestId('rotate-access-key-confirm'));
    act(() => capturedPersonalOptions?.onError?.(new Error('rotate blew up')));

    expect(await screen.findByText('rotate blew up')).toBeInTheDocument();
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
