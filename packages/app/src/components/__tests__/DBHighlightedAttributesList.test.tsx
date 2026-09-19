import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { fireEvent, screen } from '@testing-library/react';

import { DBHighlightedAttributesList } from '@/components/DBHighlightedAttributesList';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';

const traceSource = {
  id: 'trace-source',
  kind: SourceKind.Trace,
  name: 'Traces',
};

const logSource = {
  id: 'log-source',
  kind: SourceKind.Log,
  name: 'Logs',
};

describe('DBHighlightedAttributesList search conditions', () => {
  const renderList = async (
    attributeSource: TTraceSource | TLogSource,
    contextSource?: TTraceSource | TLogSource,
    pivotToAttributeSource?: boolean,
  ) => {
    const generateSearchUrl = jest.fn(() => '/search?mock');
    renderWithMantine(
      <RowSidePanelContext value={{ generateSearchUrl, source: contextSource }}>
        <DBHighlightedAttributesList
          pivotToAttributeSource={pivotToAttributeSource}
          attributes={[
            {
              source: attributeSource,
              displayedKey: 'user.id',
              value: '123',
              sql: "SpanAttributes['user.id']",
              lucene: 'user.id',
            },
          ]}
        />
      </RowSidePanelContext>,
    );
    // Open the chip's action popover, then render the search link.
    fireEvent.click(screen.getByText('user.id:'));
    await screen.findByText('Search This Value');
    return generateSearchUrl;
  };

  it('uses the lucene condition when the attribute belongs to the searched source', async () => {
    // @ts-expect-error source type
    const generateSearchUrl = await renderList(traceSource, traceSource);
    expect(generateSearchUrl).toHaveBeenCalledWith({
      where: 'user.id:"123"',
      whereLanguage: 'lucene',
      source: traceSource,
      pivot: false,
    });
  });

  it('uses the SQL condition for a cross-source attribute so the search page can build a trace-id subquery', async () => {
    // @ts-expect-error source type
    const generateSearchUrl = await renderList(logSource, traceSource);
    expect(generateSearchUrl).toHaveBeenCalledWith({
      where: "SpanAttributes['user.id'] = '123'",
      whereLanguage: 'sql',
      source: logSource,
      pivot: false,
    });
  });

  it('keeps the lucene condition when the context has no source', async () => {
    // @ts-expect-error source type
    const generateSearchUrl = await renderList(logSource, undefined);
    expect(generateSearchUrl).toHaveBeenCalledWith({
      where: 'user.id:"123"',
      whereLanguage: 'lucene',
      source: logSource,
      pivot: false,
    });
  });

  it('keeps the lucene condition and requests a pivot when pivotToAttributeSource is set (trace-level attributes)', async () => {
    // @ts-expect-error source type
    const generateSearchUrl = await renderList(logSource, traceSource, true);
    expect(generateSearchUrl).toHaveBeenCalledWith({
      where: 'user.id:"123"',
      whereLanguage: 'lucene',
      source: logSource,
      pivot: true,
    });
  });
});
