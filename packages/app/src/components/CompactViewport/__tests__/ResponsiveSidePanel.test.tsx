import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResponsiveSidePanel } from '@/components/CompactViewport/ResponsiveSidePanel';
import { useCompactViewport } from '@/components/CompactViewport/useCompactViewport';

jest.mock('@/components/CompactViewport/useCompactViewport', () => ({
  useCompactViewport: jest.fn(() => false),
}));

const useCompactViewportMock = jest.mocked(useCompactViewport);

function panelTree(opened: boolean, onClose: () => void = () => {}) {
  return (
    <MantineProvider>
      <ResponsiveSidePanel
        opened={opened}
        onClose={onClose}
        title="Filters"
        panel={<div>Service name</div>}
      >
        <div>Logs</div>
      </ResponsiveSidePanel>
    </MantineProvider>
  );
}

function renderPanel(opened: boolean, onClose?: () => void) {
  return render(panelTree(opened, onClose));
}

describe('ResponsiveSidePanel', () => {
  it('renders the panel inline on a wide viewport', () => {
    useCompactViewportMock.mockReturnValue(false);
    renderPanel(true);
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Service name')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('hides the panel until it is opened on a compact viewport', async () => {
    useCompactViewportMock.mockReturnValue(true);
    const { rerender } = renderPanel(false);
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.queryByText('Service name')).not.toBeInTheDocument();

    rerender(panelTree(true));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Service name')).toBeInTheDocument();

    rerender(panelTree(false));
    expect(screen.getByText('Service name')).toBeInTheDocument();
  });

  it('calls onClose when the drawer is dismissed', async () => {
    useCompactViewportMock.mockReturnValue(true);
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderPanel(true, onClose);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
