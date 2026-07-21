import { act, renderHook } from '@testing-library/react';

import { useCloseOnClickOutside } from '@/hooks/useCloseOnClickOutside';

function mouseDownOn(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
  });
}

describe('useCloseOnClickOutside', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('closes when clicking a plain element outside the safe zones', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    const onClose = jest.fn();
    renderHook(() => useCloseOnClickOutside({ enabled: true, onClose }));

    mouseDownOn(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the keepOpen selector', () => {
    const table = document.createElement('div');
    table.setAttribute('data-testid', 'results');
    const cell = document.createElement('span');
    table.appendChild(cell);
    document.body.appendChild(table);

    const onClose = jest.fn();
    renderHook(() =>
      useCloseOnClickOutside({
        enabled: true,
        keepOpenSelector: '[data-testid="results"]',
        onClose,
      }),
    );

    mouseDownOn(cell);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when clicking inside a floating layer (dialog/dropdown)', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const dialogChild = document.createElement('button');
    dialog.appendChild(dialogChild);

    const dropdown = document.createElement('div');
    dropdown.className = 'mantine-Select-dropdown';
    const option = document.createElement('div');
    dropdown.appendChild(option);

    document.body.append(dialog, dropdown);

    const onClose = jest.fn();
    renderHook(() => useCloseOnClickOutside({ enabled: true, onClose }));

    mouseDownOn(dialogChild);
    mouseDownOn(option);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does nothing while disabled and detaches its listener on cleanup', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);

    const onClose = jest.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useCloseOnClickOutside({ enabled, onClose }),
      { initialProps: { enabled: false } },
    );

    mouseDownOn(outside);
    expect(onClose).not.toHaveBeenCalled();

    rerender({ enabled: true });
    mouseDownOn(outside);
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    mouseDownOn(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
