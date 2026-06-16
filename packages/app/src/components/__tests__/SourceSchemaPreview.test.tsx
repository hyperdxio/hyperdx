import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SourceSchemaPreview from '../SourceSchemaPreview';

jest.mock('@/hooks/useMetadata', () => ({
  useTableMetadata: () => ({ data: undefined, isLoading: false }),
}));

jest.mock('../ChartSQLPreview', () => ({
  SQLPreview: () => <div data-testid="sql-preview">SQL Preview</div>,
}));

const mockLogSource = {
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'logs' },
};

describe('SourceSchemaPreview — controlled mode', () => {
  it('does not render the uncontrolled trigger when controlled is true', () => {
    renderWithMantine(
      <SourceSchemaPreview
        source={mockLogSource}
        controlled
        open={false}
        onClose={jest.fn()}
      />,
    );
    // The non-controlled mode would render a clickable icon/text trigger;
    // in controlled mode nothing should render when the modal is closed.
    expect(screen.queryByText('Schema')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the modal when open is true', () => {
    renderWithMantine(
      <SourceSchemaPreview
        source={mockLogSource}
        controlled
        open={true}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not show the modal when open is false', () => {
    renderWithMantine(
      <SourceSchemaPreview
        source={mockLogSource}
        controlled
        open={false}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when the modal close button is clicked', async () => {
    const onClose = jest.fn();
    renderWithMantine(
      <SourceSchemaPreview
        source={mockLogSource}
        controlled
        open={true}
        onClose={onClose}
      />,
    );
    // Mantine 9 CloseButton renders without aria-label; find by its class.
    const closeBtn = document.querySelector(
      '.mantine-Modal-close',
    ) as HTMLElement;
    expect(closeBtn).toBeTruthy();
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key press', async () => {
    const onClose = jest.fn();
    renderWithMantine(
      <SourceSchemaPreview
        source={mockLogSource}
        controlled
        open={true}
        onClose={onClose}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
