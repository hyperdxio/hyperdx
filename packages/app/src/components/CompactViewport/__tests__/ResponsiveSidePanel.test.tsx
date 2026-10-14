import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';

import { ResponsiveSidePanel } from '@/components/CompactViewport/ResponsiveSidePanel';
import { useCompactViewport } from '@/components/CompactViewport/useCompactViewport';

jest.mock('@/components/CompactViewport/useCompactViewport', () => ({
  useCompactViewport: jest.fn(() => false),
}));

const useCompactViewportMock = jest.mocked(useCompactViewport);

function renderPanel(opened: boolean) {
  return render(
    <MantineProvider>
      <ResponsiveSidePanel
        opened={opened}
        onClose={() => {}}
        panel={<div>Service name</div>}
      >
        <div>Logs</div>
      </ResponsiveSidePanel>
    </MantineProvider>,
  );
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

    rerender(
      <MantineProvider>
        <ResponsiveSidePanel
          opened
          onClose={() => {}}
          panel={<div>Service name</div>}
        >
          <div>Logs</div>
        </ResponsiveSidePanel>
      </MantineProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Service name')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
