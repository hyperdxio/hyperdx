import { fireEvent, screen } from '@testing-library/react';

import { LinkedSpanDetails } from '@/components/linkedSpans';
import { SpanLinkedFromSubpanel } from '@/components/SpanLinkedFromSubpanel';

describe('SpanLinkedFromSubpanel', () => {
  const LINK: LinkedSpanDetails = {
    TraceId: 'eeee5555ffff6666aaaa7777bbbb8888',
    SpanId: '5555666677778888',
    spanName: 'consume message',
    serviceName: 'consumer-svc',
    timestamp: '2024-01-02 12:00:01',
    durationMs: 42,
  };

  it('renders nothing when there are no links', () => {
    const { container } = renderWithMantine(
      <SpanLinkedFromSubpanel links={[]} />,
    );
    // The Mantine provider injects <style> nodes; the component itself must
    // contribute no elements.
    expect(container.querySelector('div')).toBeNull();
    expect(screen.queryByTestId('linked-from-row')).not.toBeInTheDocument();
  });

  it('renders the referencing span with service and duration', () => {
    renderWithMantine(<SpanLinkedFromSubpanel links={[LINK]} />);

    expect(screen.getByText('consume message')).toBeInTheDocument();
    expect(screen.getByText('consumer-svc')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();
  });

  it('falls back to "Open span" when the span name is missing', () => {
    renderWithMantine(
      <SpanLinkedFromSubpanel links={[{ ...LINK, spanName: undefined }]} />,
    );

    expect(screen.getByText('Open span')).toBeInTheDocument();
  });

  it('calls onOpenTrace with the referencing trace/span pair', () => {
    const onOpenTrace = jest.fn();
    renderWithMantine(
      <SpanLinkedFromSubpanel links={[LINK]} onOpenTrace={onOpenTrace} />,
    );

    fireEvent.click(screen.getByText('consume message'));

    expect(onOpenTrace).toHaveBeenCalledTimes(1);
    expect(onOpenTrace).toHaveBeenCalledWith({
      TraceId: LINK.TraceId,
      SpanId: LINK.SpanId,
      TraceState: '',
      Attributes: {},
    });
  });

  it('collapses long lists behind a show-more button', () => {
    const links = Array.from({ length: 7 }, (_, i) => ({
      ...LINK,
      SpanId: `span-${i}`,
      spanName: `span ${i}`,
    }));
    renderWithMantine(<SpanLinkedFromSubpanel links={links} />);

    expect(screen.getAllByTestId('linked-from-row')).toHaveLength(5);

    fireEvent.click(screen.getByText('Show 2 more spans'));

    expect(screen.getAllByTestId('linked-from-row')).toHaveLength(7);
  });
});
