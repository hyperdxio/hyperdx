import { fireEvent, screen } from '@testing-library/react';

import {
  AlertPanelActions,
  AlertPanelFill,
  AlertPanelLayout,
  useAlertPanel,
} from '@/components/AlertPanel';

function Controls() {
  const alertPanel = useAlertPanel();
  return (
    <>
      <button onClick={alertPanel?.open}>Open</button>
      <button onClick={alertPanel?.openDraft}>Open draft</button>
      <button onClick={alertPanel?.confirm}>Confirm</button>
      <button onClick={alertPanel?.close}>Close</button>
    </>
  );
}

function renderLayout({
  defaultOpened = false,
  withContent = true,
}: {
  defaultOpened?: boolean;
  withContent?: boolean;
}) {
  const onOpen = jest.fn();
  const onCancel = jest.fn();
  renderWithMantine(
    <AlertPanelLayout
      defaultOpened={defaultOpened}
      onOpen={onOpen}
      onCancel={onCancel}
      actions={<span data-testid="alert-action" />}
    >
      <Controls />
      {withContent && (
        <AlertPanelFill>
          <span data-testid="alert-settings" />
          <AlertPanelActions />
        </AlertPanelFill>
      )}
    </AlertPanelLayout>,
  );
  return { onOpen, onCancel };
}

const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

describe('AlertPanel', () => {
  it('renders the content in place without a layout', () => {
    renderWithMantine(
      <div data-testid="origin">
        <AlertPanelFill>
          <span data-testid="alert-settings" />
        </AlertPanelFill>
      </div>,
    );

    expect(screen.getByTestId('origin')).toContainElement(
      screen.getByTestId('alert-settings'),
    );
  });

  it('renders the content, and the action where it places it, when open', () => {
    renderLayout({ defaultOpened: true });

    const panel = screen.getByTestId('alert-panel');
    expect(panel).toContainElement(screen.getByTestId('alert-settings'));
    expect(panel).toContainElement(screen.getByTestId('alert-action'));
  });

  it('renders no action outside a layout', () => {
    renderWithMantine(<AlertPanelActions />);

    expect(screen.queryByTestId('alert-action')).not.toBeInTheDocument();
  });

  it('renders nothing while the panel is closed', () => {
    renderLayout({ defaultOpened: false });

    expect(screen.queryByTestId('alert-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-settings')).not.toBeInTheDocument();
  });

  it('stays out of the layout with nothing to show', () => {
    renderLayout({ defaultOpened: true, withContent: false });

    expect(screen.queryByTestId('alert-panel')).not.toBeInTheDocument();
  });

  it('widens when its edge is dragged left', () => {
    // jsdom lays nothing out, and useResizable caps widths by the body's.
    jest.spyOn(document.body, 'offsetWidth', 'get').mockReturnValue(1024);
    renderLayout({ defaultOpened: true });

    const panel = screen.getByTestId('alert-panel');
    const startWidth = parseFloat(panel.style.width);
    fireEvent.mouseDown(screen.getByTestId('alert-panel-resize-handle'), {
      clientX: 600,
    });
    fireEvent.mouseMove(document, { clientX: 500 });
    fireEvent.mouseUp(document);

    expect(parseFloat(panel.style.width)).toBeGreaterThan(startWidth);
  });

  it('discards a draft closed without confirming', () => {
    const { onCancel } = renderLayout({});

    click('Open draft');
    expect(screen.getByTestId('alert-settings')).toBeInTheDocument();
    click('Close');

    expect(onCancel).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId('alert-panel')).not.toBeInTheDocument();
  });

  it('snapshots an existing alert as the panel opens on it', () => {
    const { onOpen } = renderLayout({});

    click('Open');
    click('Open');

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('takes no snapshot of a draft', () => {
    const { onOpen } = renderLayout({});

    click('Open draft');

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('cancels only the edits, not the alert, once a draft is confirmed', () => {
    const { onCancel } = renderLayout({});

    click('Open draft');
    click('Confirm');
    expect(onCancel).not.toHaveBeenCalled();

    click('Open');
    click('Close');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(false);
  });
});
