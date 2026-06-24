import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { SourcesList } from '@/components/Sources/SourcesList';
import { useConnections } from '@/connection';
import { useSources } from '@/source';

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn(), query: {}, pathname: '/' }),
}));
jest.mock('@/source', () => ({ useSources: jest.fn() }));
jest.mock('@/connection', () => ({ useConnections: jest.fn() }));
jest.mock('@/config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('@/utils', () => ({
  capitalizeFirstLetter: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
}));
// TableSourceForm only renders while editing/creating; stub it so the list test
// does not pull in the full source form.
jest.mock('../Sources/SourceForm', () => ({ TableSourceForm: () => null }));

const asMock = (fn: unknown) => fn as jest.Mock;

const makeSource = (
  id: string,
  name: string,
  overrides: Partial<TSource> = {},
): TSource =>
  ({
    id,
    name,
    kind: SourceKind.Log,
    connection: 'conn-a',
    ...overrides,
  }) as unknown as TSource;

describe('SourcesList section display', () => {
  beforeEach(() => {
    asMock(useConnections).mockReturnValue({
      data: [{ id: 'conn-a', name: 'Default' }],
      isLoading: false,
      refetch: jest.fn(),
    });
  });

  it('shows the section on a sectioned source and nothing on an unsectioned one', () => {
    asMock(useSources).mockReturnValue({
      data: [
        makeSource('a', 'Billing Logs', { section: 'Billing' }),
        makeSource('b', 'Plain Source'),
      ],
      isLoading: false,
      refetch: jest.fn(),
    });
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('Billing Logs')).toBeInTheDocument();
    expect(screen.getByText('Plain Source')).toBeInTheDocument();
    // The section label renders only for the source that has one.
    expect(screen.getAllByText('Billing')).toHaveLength(1);
  });

  it('shows no section labels when no source has a section', () => {
    asMock(useSources).mockReturnValue({
      data: [makeSource('a', 'Logs'), makeSource('b', 'Traces')],
      isLoading: false,
      refetch: jest.fn(),
    });
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Traces')).toBeInTheDocument();
  });
});
