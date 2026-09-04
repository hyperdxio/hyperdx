import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DBHighlightedAttributesList,
  type HighlightedAttribute,
} from '@/components/DBHighlightedAttributesList';
import {
  RowSidePanelContext,
  type RowSidePanelContextProps,
} from '@/components/DBRowSidePanel';

const source = { id: 'src-1', kind: SourceKind.Log } as TSource;

const attribute: HighlightedAttribute = {
  source,
  displayedKey: 'ServiceName',
  value: 'checkout',
  sql: `ServiceName`,
  lucene: 'service',
};

async function openSearchLink(context: RowSidePanelContextProps) {
  renderWithMantine(
    <RowSidePanelContext value={context}>
      <DBHighlightedAttributesList attributes={[attribute]} />
    </RowSidePanelContext>,
  );

  await userEvent.click(screen.getByText('checkout'));
  return screen.findByRole('link', { hidden: true });
}

describe('DBHighlightedAttributesList', () => {
  it('uses the Lucene expression a source defines for the attribute', async () => {
    const generateSearchUrl = jest.fn(() => '/search');

    await openSearchLink({ generateSearchUrl });

    expect(generateSearchUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        where: 'service:"checkout"',
        whereLanguage: 'lucene',
      }),
    );
  });

  // Explore discards a Lucene WHERE, so sending one would make the action a
  // no-op. The SQL form of the same attribute is already to hand.
  it('sends the SQL expression to a page that only takes SQL', async () => {
    const generateSearchUrl = jest.fn(() => '/explore');

    await openSearchLink({ generateSearchUrl, sqlOnlySearchUrl: true });

    expect(generateSearchUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        where: `ServiceName = 'checkout'`,
        whereLanguage: 'sql',
      }),
    );
  });
});
