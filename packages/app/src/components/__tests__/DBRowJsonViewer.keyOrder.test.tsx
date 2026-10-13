import React from 'react';
import { Provider } from 'jotai';
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DBRowJsonViewer } from '@/components/DBRowJsonViewer';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));

jest.mock('@/useFormatTime', () => ({
  useFormatTime: () => (time: unknown) => String(time),
  FormatTime: jest.fn(() => null),
}));

const VIEWER_OPTIONS_KEY = 'hdx_json_viewer_options';

// Options written before the sort setting existed — no `keyOrder` key.
const LEGACY_STORED_OPTIONS = {
  normallyExpanded: true,
  whiteSpace: 'pre-wrap',
  tabulate: true,
  filterBlanks: false,
};

const data = { zebra: 'z', alpha: 'a', Mango: 'm' };

// env="test" mounts the menu dropdown without a transition to wait on. The
// viewer options atom is module-scoped, so each render gets its own jotai store;
// the atom then reads localStorage when it mounts in that store.
const renderViewer = () =>
  render(
    <Provider>
      <MantineProvider env="test">
        <RowSidePanelContext value={{}}>
          <DBRowJsonViewer data={data} />
        </RowSidePanelContext>
      </MantineProvider>
    </Provider>,
  );

const renderedKeys = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.keyContainer > .key')).map(el =>
    el.textContent?.trim(),
  );

const openOptionsMenu = async () => {
  await userEvent.click(screen.getByTestId('json-viewer-options-menu'));
  await screen.findByRole('menu');
};

const selectKeyOrder = async (value: 'asc' | 'desc' | 'original') => {
  await openOptionsMenu();
  await userEvent.click(screen.getByTestId(`json-viewer-key-order-${value}`));
};

const storedKeyOrder = () =>
  JSON.parse(localStorage.getItem(VIEWER_OPTIONS_KEY) ?? '{}').keyOrder;

describe('DBRowJsonViewer key order', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('sorts alphabetically when stored options predate the setting', async () => {
    localStorage.setItem(
      VIEWER_OPTIONS_KEY,
      JSON.stringify(LEGACY_STORED_OPTIONS),
    );
    const { container } = renderViewer();

    expect(renderedKeys(container)).toEqual(['alpha', 'Mango', 'zebra']);

    await openOptionsMenu();
    expect(
      screen.getByTestId('json-viewer-key-order-asc').querySelector('.ps-2'),
    ).toBeInTheDocument();
  });

  it('restores a stored order on render', async () => {
    localStorage.setItem(
      VIEWER_OPTIONS_KEY,
      JSON.stringify({ ...LEGACY_STORED_OPTIONS, keyOrder: 'original' }),
    );
    const { container } = renderViewer();

    expect(renderedKeys(container)).toEqual(['zebra', 'alpha', 'Mango']);
  });

  it('switches between the stored order and reverse alphabetical', async () => {
    const { container } = renderViewer();

    expect(renderedKeys(container)).toEqual(['alpha', 'Mango', 'zebra']);

    await selectKeyOrder('original');
    expect(renderedKeys(container)).toEqual(['zebra', 'alpha', 'Mango']);
    expect(storedKeyOrder()).toBe('original');

    await selectKeyOrder('desc');
    expect(renderedKeys(container)).toEqual(['zebra', 'Mango', 'alpha']);
    expect(storedKeyOrder()).toBe('desc');

    await selectKeyOrder('asc');
    expect(renderedKeys(container)).toEqual(['alpha', 'Mango', 'zebra']);
    expect(storedKeyOrder()).toBe('asc');
  });
});
