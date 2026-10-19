import { screen } from '@testing-library/react';

import { WhatsNewHighlightRow } from '@/components/AppNav/WhatsNewHighlightRow';

// click-ui encodes state only in hashed CSS module class names, so the mock
// exposes the props as attributes to assert on.
jest.mock('@clickhouse/click-ui', () => ({
  ...jest.requireActual('@clickhouse/click-ui'),
  Badge: ({ text, state }: { text: React.ReactNode; state?: string }) => (
    <span data-testid="badge" data-state={state}>
      {text}
    </span>
  ),
}));

describe('WhatsNewHighlightRow', () => {
  it.each([
    ['breaking', 'Breaking', 'danger'],
    ['feature', 'New', 'info'],
  ] as const)(
    'renders a %s headline with the %s badge',
    (kind, label, state) => {
      renderWithMantine(
        <WhatsNewHighlightRow headline={{ kind, text: 'A headline' }} />,
      );

      const badge = screen.getByTestId('badge');
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveAttribute('data-state', state);
      expect(screen.getByTestId('whats-new-headline')).toHaveTextContent(
        'A headline',
      );
    },
  );
});
