import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import SidePanelBreadcrumbs, {
  BreadcrumbItem,
} from '@/components/SidePanelBreadcrumbs';

function renderCrumbs(items: BreadcrumbItem[], onBack = jest.fn()) {
  const utils = render(
    <MantineProvider>
      <SidePanelBreadcrumbs items={items} onBack={onBack} />
    </MantineProvider>,
  );
  return { ...utils, onBack };
}

describe('SidePanelBreadcrumbs', () => {
  it('renders each item label', () => {
    renderCrumbs([
      { label: 'Root', sourceKind: SourceKind.Log },
      { label: 'Leaf', sourceKind: SourceKind.Trace },
    ]);
    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Leaf')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', () => {
    const { onBack } = renderCrumbs([{ label: 'Root' }]);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('invokes onClick for a non-last (ancestor) breadcrumb', () => {
    const onClick = jest.fn();
    renderCrumbs([{ label: 'Ancestor', onClick }, { label: 'Current' }]);
    fireEvent.click(screen.getByText('Ancestor'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not make the last (current) item clickable', () => {
    const onClick = jest.fn();
    // Even though onClick is supplied, the leaf is the current view.
    renderCrumbs([{ label: 'Ancestor' }, { label: 'Current', onClick }]);
    fireEvent.click(screen.getByText('Current'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('truncates an over-length single label with an ellipsis', () => {
    const long = 'x'.repeat(150); // > MAX_LABEL_LENGTH_SINGLE (120)
    const { container } = renderCrumbs([{ label: long }]);
    // The full label is not rendered verbatim; the visible text is truncated.
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    expect(container.textContent).toContain('…');
  });

  it('truncates an ancestor label more aggressively than the current one', () => {
    const label = 'y'.repeat(30); // > previous(20), < current(40)
    // As an ancestor (not last) it should be truncated to 20 + ellipsis.
    renderCrumbs([{ label }, { label: 'Current' }]);
    expect(screen.getByText(`${'y'.repeat(20)}…`)).toBeInTheDocument();
  });

  it.each([
    [SourceKind.Log, 'tabler-icon-logs'],
    [SourceKind.Trace, 'tabler-icon-connection'],
    [SourceKind.Session, 'tabler-icon-device-laptop'],
  ])('renders the %s source icon on the first item', (kind, iconClass) => {
    const { container } = renderCrumbs([{ label: 'First', sourceKind: kind }]);
    expect(container.querySelector(`.${iconClass}`)).toBeInTheDocument();
  });
});
