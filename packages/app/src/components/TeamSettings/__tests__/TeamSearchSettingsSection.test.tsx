import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import api from '@/api';
import TeamSearchSettingsSection from '@/components/TeamSettings/TeamSearchSettingsSection';

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
    useUpdateSearchSettings: jest.fn(),
  },
}));

const mockUseMe: jest.Mock = jest.mocked(api.useMe);
const mockUseUpdateSearchSettings: jest.Mock = jest.mocked(
  api.useUpdateSearchSettings,
);

type MutateOptions = { onSuccess?: () => void; onError?: () => void };
const mutate = jest.fn((_vars: unknown, options?: MutateOptions) =>
  options?.onSuccess?.(),
);
const refetchMe = jest.fn();

function setRestriction(restriction?: 'sql' | 'lucene') {
  mockUseMe.mockReturnValue({
    data: { team: { queryLanguageRestriction: restriction } },
    refetch: refetchMe,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setRestriction(undefined);
  mockUseUpdateSearchSettings.mockReturnValue({ mutate, isPending: false });
});

describe('TeamSearchSettingsSection', () => {
  it('shows both languages allowed when the team has no restriction', () => {
    renderWithMantine(<TeamSearchSettingsSection />);

    expect(screen.getByTestId('team-query-language-select')).toHaveValue(
      'Lucene and SQL',
    );
  });

  it('shows the current restriction', () => {
    setRestriction('sql');
    renderWithMantine(<TeamSearchSettingsSection />);

    expect(screen.getByTestId('team-query-language-select')).toHaveValue(
      'SQL only',
    );
  });

  it('saves a restriction and refetches the team', async () => {
    const user = userEvent.setup();
    renderWithMantine(<TeamSearchSettingsSection />);

    await user.click(screen.getByTestId('team-query-language-select'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'Lucene only', hidden: true }),
    );

    expect(mutate).toHaveBeenCalledWith(
      { queryLanguageRestriction: 'lucene' },
      expect.any(Object),
    );
    expect(refetchMe).toHaveBeenCalled();
  });

  it('sends null to lift the restriction', async () => {
    setRestriction('lucene');
    const user = userEvent.setup();
    renderWithMantine(<TeamSearchSettingsSection />);

    await user.click(screen.getByTestId('team-query-language-select'));
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'Lucene and SQL',
        hidden: true,
      }),
    );

    expect(mutate).toHaveBeenCalledWith(
      { queryLanguageRestriction: null },
      expect.any(Object),
    );
  });

  it('does not save when the selection is unchanged', async () => {
    setRestriction('sql');
    const user = userEvent.setup();
    renderWithMantine(<TeamSearchSettingsSection />);

    await user.click(screen.getByTestId('team-query-language-select'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'SQL only', hidden: true }),
    );

    expect(mutate).not.toHaveBeenCalled();
  });
});
