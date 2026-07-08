import { fireEvent, screen } from '@testing-library/react';

import { SpanLinksSubpanel } from '@/components/SpanLinksSubpanel';

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

const LINK_C = {
  TraceId: 'cccc9999dddd0000eeee1111ffff2222',
  SpanId: '9999000011112222',
  TraceState: '',
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

  it('renders an Open trace action and the link attributes as chips', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A]} />);

    expect(screen.getByText('Open trace')).toBeInTheDocument();
    // Attributes render as compact EventTag pills (key: value).
    expect(screen.getByText('link.kind: child_of')).toBeInTheDocument();
  });

  it('calls onOpenTrace with the link when Open trace is clicked', () => {
    const onOpenTrace = jest.fn();
    renderWithMantine(
      <SpanLinksSubpanel spanLinks={[LINK_A]} onOpenTrace={onOpenTrace} />,
    );

    fireEvent.click(screen.getByText('Open trace'));

    expect(onOpenTrace).toHaveBeenCalledTimes(1);
    expect(onOpenTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        TraceId: LINK_A.TraceId,
        SpanId: LINK_A.SpanId,
      }),
    );
  });

  it('renders one Open trace action per link', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A, LINK_B]} />);

    expect(screen.getAllByText('Open trace')).toHaveLength(2);
    expect(screen.getByText('link.kind: child_of')).toBeInTheDocument();
  });

  it('renders trace state as a labeled chip', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_B]} />);

    expect(
      screen.getByText('trace state: congo=t61rcWkgMzE'),
    ).toBeInTheDocument();
  });

  it('collapses to just the action when a link has no trace state or attributes', () => {
    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_C]} />);

    expect(screen.getByText('Open trace')).toBeInTheDocument();
    expect(screen.queryByText(/trace state:/)).not.toBeInTheDocument();
  });

  it('filters out malformed links missing a string TraceId or SpanId', () => {
    const malformed = {
      TraceId: 12345,
      SpanId: 'deadbeefdeadbeef',
      TraceState: '',
      Attributes: {},
    } as unknown as Record<string, unknown>;

    renderWithMantine(<SpanLinksSubpanel spanLinks={[LINK_A, malformed]} />);

    expect(screen.getAllByText('Open trace')).toHaveLength(1);
    expect(screen.getByText('link.kind: child_of')).toBeInTheDocument();
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
