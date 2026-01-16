import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { NumberFormatForm, NumberFormatInput } from '../NumberFormat';

describe('NumberFormat', () => {
  describe('NumberFormatForm', () => {
    const mockOnApply = jest.fn();
    const mockOnClose = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('renders time input unit dropdown with all options', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      // Find the Input unit select
      const select = screen.getByLabelText('Input unit');
      expect(select).toBeInTheDocument();

      // Check that all time unit options are present
      const options = (select as HTMLSelectElement).options;
      expect(options).toHaveLength(4);
      expect(options[0].value).toBe('1');
      expect(options[0].text).toBe('Seconds');
      expect(options[1].value).toBe('0.001');
      expect(options[1].text).toBe('Milliseconds');
      expect(options[2].value).toBe('0.000001');
      expect(options[2].text).toBe('Microseconds');
      expect(options[3].value).toBe('0.000000001');
      expect(options[3].text).toBe('Nanoseconds');
    });

    it('correctly sets factor value for seconds', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit') as HTMLSelectElement;
      expect(select.value).toBe('1');
    });

    it('correctly sets factor value for milliseconds', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 0.001,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit') as HTMLSelectElement;
      expect(select.value).toBe('0.001');
    });

    it('correctly sets factor value for microseconds', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 0.000001,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit') as HTMLSelectElement;
      expect(select.value).toBe('0.000001');
    });

    it('correctly sets factor value for nanoseconds', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 0.000000001,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit') as HTMLSelectElement;
      expect(select.value).toBe('0.000000001');
    });

    it('calls onApply with microseconds factor when microseconds is selected', async () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit');
      fireEvent.change(select, { target: { value: '0.000001' } });

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockOnApply).toHaveBeenCalledWith(
          expect.objectContaining({
            factor: 0.000001,
          }),
        );
      });
    });

    it('calls onApply with nanoseconds factor when nanoseconds is selected', async () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={timeFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const select = screen.getByLabelText('Input unit');
      fireEvent.change(select, { target: { value: '0.000000001' } });

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockOnApply).toHaveBeenCalledWith(
          expect.objectContaining({
            factor: 0.000000001,
          }),
        );
      });
    });

    it('shows time input unit dropdown only when output is time', () => {
      const numberFormat = {
        output: 'number' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatForm
          value={numberFormat}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      expect(screen.queryByLabelText('Input unit')).not.toBeInTheDocument();
    });

    it('calls onClose when Cancel button is clicked', () => {
      renderWithMantine(
        <NumberFormatForm
          value={undefined}
          onApply={mockOnApply}
          onClose={mockOnClose}
        />,
      );

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('NumberFormatInput', () => {
    const mockOnChange = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('opens drawer when button is clicked', async () => {
      renderWithMantine(
        <NumberFormatInput value={undefined} onChange={mockOnChange} />,
      );

      const button = screen.getByText('Set number format');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Number format')).toBeInTheDocument();
      });
    });

    it('displays format name when value is set', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 0.000001,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatInput value={timeFormat} onChange={mockOnChange} />,
      );

      expect(screen.getByText('Time')).toBeInTheDocument();
    });

    it('calls onChange with undefined when clear button is clicked', () => {
      const timeFormat = {
        output: 'time' as const,
        factor: 1,
        mantissa: 2,
        thousandSeparated: true,
      };

      renderWithMantine(
        <NumberFormatInput value={timeFormat} onChange={mockOnChange} />,
      );

      // Find the X button (clear button)
      const clearButton = screen.getAllByRole('button')[1]; // Second button is the clear button
      fireEvent.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith(undefined);
    });
  });
});
