import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';
import OrgApiKeysSection from '@/components/TeamSettings/OrgApiKeysSection';
import { useConfirm } from '@/useConfirm';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useOrgApiKeys: jest.fn(),
    useCreateOrgApiKey: jest.fn(),
    useUpdateOrgApiKey: jest.fn(),
    useDeleteOrgApiKey: jest.fn(),
  },
  hdxServer: jest.fn(),
}));

jest.mock('@/useConfirm', () => ({ useConfirm: jest.fn() }));

const mockUseOrgApiKeys: jest.Mock = jest.mocked(api.useOrgApiKeys);
const mockUseCreate: jest.Mock = jest.mocked(api.useCreateOrgApiKey);
const mockUseUpdate: jest.Mock = jest.mocked(api.useUpdateOrgApiKey);
const mockUseDelete: jest.Mock = jest.mocked(api.useDeleteOrgApiKey);
const mockUseConfirm: jest.Mock = jest.mocked(useConfirm);

const createMutate = jest.fn();
const deleteMutate = jest.fn();
let confirmAccepts = true;

const key = (overrides = {}) => ({
  id: 'k1',
  description: 'terraform',
  scope: 'member',
  createdAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  lastUsedAt: '2026-10-02T00:00:00.000Z',
  createdBy: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
  ...overrides,
});

const setKeys = (data: ReturnType<typeof key>[]) =>
  mockUseOrgApiKeys.mockReturnValue({ data: { data }, isLoading: false });

beforeEach(() => {
  jest.clearAllMocks();
  confirmAccepts = true;
  setKeys([]);
  mockUseCreate.mockReturnValue({ mutate: createMutate, isPending: false });
  mockUseUpdate.mockReturnValue({ mutateAsync: jest.fn() });
  mockUseDelete.mockReturnValue({ mutate: deleteMutate });
  mockUseConfirm.mockReturnValue(() => Promise.resolve(confirmAccepts));
});

describe('OrgApiKeysSection', () => {
  it('shows an empty state with no keys', () => {
    renderWithMantine(<OrgApiKeysSection />);
    expect(
      screen.getByText('No organization API keys yet'),
    ).toBeInTheDocument();
  });

  it('shows an error instead of the empty state when loading fails', () => {
    mockUseOrgApiKeys.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderWithMantine(<OrgApiKeysSection />);
    expect(
      screen.getByText("Couldn't load organization API keys"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No organization API keys yet'),
    ).not.toBeInTheDocument();
  });

  it('labels deleted creators, unused keys, and expired keys', () => {
    setKeys([
      key({
        createdBy: null,
        lastUsedAt: null,
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
    ]);
    renderWithMantine(<OrgApiKeysSection />);
    expect(screen.getByText('Deleted user')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('creates a member key expiring in 30 days by default and shows it once', async () => {
    createMutate.mockImplementation((_vars, options) =>
      options?.onSuccess?.({ ...key(), key: 'hdx_org_secret' }),
    );
    renderWithMantine(<OrgApiKeysSection />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create API key' }),
    );
    await userEvent.type(
      await screen.findByLabelText('Description'),
      'terraform',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createMutate).toHaveBeenCalledWith(
      { description: 'terraform', scope: 'member', expiry: '30d' },
      expect.anything(),
    );
    expect(
      await screen.findByText(
        "Copy this key now. You won't be able to see it again.",
      ),
    ).toBeInTheDocument();
  });

  it('revokes only after confirming', async () => {
    setKeys([key()]);
    confirmAccepts = false;
    renderWithMantine(<OrgApiKeysSection />);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(deleteMutate).not.toHaveBeenCalled());

    confirmAccepts = true;
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(deleteMutate).toHaveBeenCalledWith(
        { id: 'k1' },
        expect.anything(),
      ),
    );
  });

  it('marks a key expired once its expiry passes while the page is open', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T00:00:00.000Z') });
    try {
      setKeys([key({ expiresAt: '2026-10-01T00:00:30.000Z' })]);
      renderWithMantine(<OrgApiKeysSection />);
      expect(screen.queryByText('Expired')).not.toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByText('Expired')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('limits descriptions to 100 characters and reports failed edits', async () => {
    setKeys([key()]);
    mockUseUpdate.mockReturnValue({
      mutateAsync: jest.fn().mockRejectedValue(new Error('Save failed')),
    });
    renderWithMantine(<OrgApiKeysSection />);

    const input = screen.getByLabelText('API key description');
    expect(input).toHaveAttribute('maxLength', '100');
    await userEvent.clear(input);
    await userEvent.type(input, 'ci{Enter}');
    expect(
      await screen.findByText("Couldn't rename API key: Save failed"),
    ).toBeInTheDocument();
  });

  it('keeps the create dialog open while the key is being created', async () => {
    mockUseCreate.mockReturnValue({ mutate: createMutate, isPending: true });
    renderWithMantine(<OrgApiKeysSection />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Create API key' }),
    );
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancel).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });
});
