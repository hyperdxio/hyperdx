import { screen } from '@testing-library/react';

import { SpanLinksSubpanel } from '../SpanLinksSubpanel';

// Stub the JSON viewer so the assertions focus on the subpanel's row shaping,
// column rendering and empty-state logic rather than the viewer internals.
jest.mock('../DBRowJsonViewer', () => ({
  DBRowJsonViewer: ({ data }: { data: unknown }) => (
    <div data-testid="json-viewer">{JSON.stringify(data)}</div>
  ),
}));

const LINK_A = {
  TraceId: 'aaaa1111bbbb2222cccc3333dddd4444',
  SpanId: '1111222233334444',
  TraceState: '',
  Attributes: { 'link.kind': 'child_of' },
};

const LINK_B = {
  TraceId: 'eeee5555ffff6666aaaa7777bbbb8888',
  SpanId: '5555666677778888',
  TraceState: 'congo=t61rcWkgMzE',
  Attributes: {},
};

describe('SpanLinksSubpanel', () => {
  it('renders the empty state when spanLinks is undefined', () => {
    renderWithMantine(<SpanLinksSubpanel />);
    expect(
      screen.getByText('No span links available for this trace'),
    ).toBeInTheDocument();
  });

  it('renders the empty state when spanLinks is an empty array', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[]} />);
    expect(
      screen.getByText('No span links available for this trace'),
    ).toBeInTheDocument();
  });

  it('renders the column headers and a single link', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A]} />);

    expect(screen.getByText('Trace ID')).toBeInTheDocument();
    expect(screen.getByText('Span ID')).toBeInTheDocument();
    expect(screen.getByText('Trace State')).toBeInTheDocument();
    expect(screen.getByText('Attributes')).toBeInTheDocument();

    expect(screen.getByText(LINK_A.TraceId)).toBeInTheDocument();
    expect(screen.getByText(LINK_A.SpanId)).toBeInTheDocument();
    // Attributes flow through the JSON viewer.
    expect(screen.getByTestId('json-viewer')).toHaveTextContent('link.kind');
  });

  it('renders multiple links', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A, LINK_B]} />);

    expect(screen.getByText(LINK_A.TraceId)).toBeInTheDocument();
    expect(screen.getByText(LINK_B.TraceId)).toBeInTheDocument();
    expect(screen.getByText(LINK_B.TraceState)).toBeInTheDocument();
  });

  it('shows the Empty placeholder for a link with no attributes', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_B]} />);

    // LINK_B has an empty Attributes map and an empty-by-default Trace State
    // is not present here, so only the Attributes cell renders "Empty".
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.queryByTestId('json-viewer')).not.toBeInTheDocument();
  });

  it('filters out malformed links missing a string TraceId or SpanId', () => {
    const malformed = {
      TraceId: 12345,
      SpanId: 'deadbeefdeadbeef',
      TraceState: '',
      Attributes: {},
    } as unknown as Record<string, unknown>;

    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A, malformed]} />);

    expect(screen.getByText(LINK_A.TraceId)).toBeInTheDocument();
    expect(screen.queryByText('12345')).not.toBeInTheDocument();
  });

  it('renders the empty state when every link is malformed', () => {
    const malformed = {
      SpanId: 'deadbeefdeadbeef',
      Attributes: {},
    } as unknown as Record<string, unknown>;

    renderWithMantine(<SpanLinksSubpanel spanLinks={[malformed]} />);

    expect(
      screen.getByText('No span links available for this trace'),
    ).toBeInTheDocument();
  });
});
