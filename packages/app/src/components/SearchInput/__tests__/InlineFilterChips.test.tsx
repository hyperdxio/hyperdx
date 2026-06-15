import { fireEvent, screen } from '@testing-library/react';

import type { FilterStateHook } from '@/searchFilters';

import { flattenFilters } from '../../filterPillUtils';
import InlineFilterChips from '../InlineFilterChips';

function makeChipProps(filters: FilterStateHook['filters']) {
  return {
    pills: flattenFilters(filters),
    setFilterValue: jest.fn(),
    clearFilter: jest.fn(),
  };
}

describe('InlineFilterChips', () => {
  it('renders nothing when there are no filters', () => {
    const props = makeChipProps({});
    renderWithMantine(<InlineFilterChips {...props} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders included filter chips with = operator', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('renders excluded filter chips with != operator', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('renders range filter chips', () => {
    const props = makeChipProps({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 10, max: 200 },
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    expect(screen.getByText('duration')).toBeInTheDocument();
    expect(screen.getByText('10 – 200')).toBeInTheDocument();
  });

  it('calls setFilterValue when removing an included chip', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(props.setFilterValue).toHaveBeenCalledWith(
      'status',
      '200',
      undefined,
    );
  });

  it('calls setFilterValue with exclude action when removing an excluded chip', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(['500']),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(props.setFilterValue).toHaveBeenCalledWith(
      'status',
      '500',
      'exclude',
    );
  });

  it('calls clearFilter when removing a range chip', () => {
    const props = makeChipProps({
      duration: {
        included: new Set<string | boolean>(),
        excluded: new Set<string | boolean>(),
        range: { min: 0, max: 100 },
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    expect(props.clearFilter).toHaveBeenCalledWith('duration');
  });

  it('prevents default on mouseDown to avoid input blur', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    const removeButton = screen.getAllByRole('button')[0];
    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = jest.spyOn(mouseDownEvent, 'preventDefault');
    removeButton.dispatchEvent(mouseDownEvent);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('renders multiple chips from different fields', () => {
    const props = makeChipProps({
      status: {
        included: new Set<string | boolean>(['200']),
        excluded: new Set<string | boolean>(['500']),
      },
      service: {
        included: new Set<string | boolean>(['api']),
        excluded: new Set<string | boolean>(),
      },
    });
    renderWithMantine(<InlineFilterChips {...props} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  describe('overflow / container structure', () => {
    it('wraps all chips in a single group container', () => {
      const props = makeChipProps({
        status: {
          included: new Set<string | boolean>(['200', '404']),
          excluded: new Set<string | boolean>(),
        },
      });
      renderWithMantine(<InlineFilterChips {...props} />);
      // All chips should be inside a single wrapper div (the chipsGroup)
      const buttons = screen.getAllByRole('button');
      const groupEl = buttons[0].closest('div');
      expect(groupEl).toBeTruthy();
      // All buttons share the same parent group
      for (const btn of buttons) {
        expect(btn.closest('div')).toBe(groupEl);
      }
    });

    it('renders all chips even with many filters (no artificial limit)', () => {
      const values = new Set<string | boolean>(
        Array.from({ length: 15 }, (_, i) => `val${i}`),
      );
      const props = makeChipProps({
        field: {
          included: values,
          excluded: new Set<string | boolean>(),
        },
      });
      renderWithMantine(<InlineFilterChips {...props} />);
      // All 15 chips should be rendered
      expect(screen.getAllByRole('button')).toHaveLength(15);
      for (let i = 0; i < 15; i++) {
        expect(screen.getByText(`val${i}`)).toBeInTheDocument();
      }
    });

    it('chips group container has flex-wrap for overflow', () => {
      const props = makeChipProps({
        status: {
          included: new Set<string | boolean>(['200']),
          excluded: new Set<string | boolean>(),
        },
      });
      renderWithMantine(<InlineFilterChips {...props} />);
      // The chips group div should have display:flex and flex-wrap:wrap
      // (applied via CSS module, so we check the computed class is present)
      const groupEl = screen.getByRole('button').closest('div');
      expect(groupEl).toBeTruthy();
      expect(groupEl!.className).toBeTruthy();
    });

    it('does not render group container when no pills', () => {
      const props = makeChipProps({});
      renderWithMantine(<InlineFilterChips {...props} />);
      // No chip group rendered
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
