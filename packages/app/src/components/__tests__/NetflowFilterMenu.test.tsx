import { MantineProvider } from '@mantine/core';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import NetflowFilterMenu from '@/components/NetflowFilterMenu';
import NetflowSankeyTable from '@/components/NetflowSankeyTable';
import { buildNetflowSankeyData } from '@/netflowSankey';

describe('NetFlow filter menus', () => {
  it('allocates a popover only after interaction and reopens after closing', async () => {
    renderWithMantine(
      <MantineProvider env="test">
        <NetflowFilterMenu field="protocol" value="TCP" onFilter={jest.fn()} />
      </MantineProvider>,
    );
    const target = () =>
      screen.getByRole('button', { name: 'Filter Protocol: TCP' });
    expect(target()).not.toHaveAttribute('id');
    fireEvent.click(target());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Include' }));
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    fireEvent.click(target());
    expect(
      await screen.findByRole('menuitem', { name: 'Exclude' }),
    ).toBeVisible();
  });

  it.each([
    ['Include', false],
    ['Exclude', true],
  ] as const)(
    'announces the human field label and handles %s for the raw value',
    async (action, excluded) => {
      const onFilter = jest.fn();
      renderWithMantine(
        <NetflowFilterMenu
          field="srcAddr"
          value="2001:db8::1"
          onFilter={onFilter}
        />,
      );
      const target = screen.getByRole('button', {
        name: 'Filter Source IP: 2001:db8::1',
      });
      fireEvent.click(target);
      fireEvent.click(await screen.findByRole('menuitem', { name: action }));
      expect(onFilter).toHaveBeenLastCalledWith(
        'srcAddr',
        '2001:db8::1',
        excluded,
      );
    },
  );

  it('opens custom SVG targets with the keyboard', async () => {
    const onSelect = jest.fn();
    renderWithMantine(
      <svg>
        <NetflowFilterMenu
          label="Provider"
          value="edge"
          onSelect={onSelect}
          target={({ buttonProps }) => (
            <g {...buttonProps}>
              <rect width={20} height={20} />
            </g>
          )}
        />
      </svg>,
    );
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Filter Provider: edge' }),
      { key: 'Enter' },
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Include' }));
    expect(onSelect).toHaveBeenCalledWith(false);
  });

  it('does not offer filters for missing mapped values', () => {
    renderWithMantine(
      <NetflowFilterMenu field="exporter" value="" onFilter={jest.fn()} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps empty Sankey dimensions filterable using their raw empty value', async () => {
    const onFilter = jest.fn();
    const dimensions = [
      { key: 'custom', label: 'Provider', expression: 'Provider' },
      { key: 'exporter', label: 'Exporter', expression: 'Exporter' },
    ];
    const data = buildNetflowSankeyData(
      [
        {
          __netflow_dimension_0: '',
          __netflow_dimension_1: 'edge',
          __netflow_value: 10,
        },
      ],
      dimensions,
    );
    renderWithMantine(
      <NetflowSankeyTable
        data={data}
        dimensions={dimensions}
        rangeSeconds={60}
        onFilter={onFilter}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Filter Provider: (empty)' }),
    );
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Exclude' }));
    expect(onFilter).toHaveBeenCalledWith(dimensions[0], '', true);
  });
});
