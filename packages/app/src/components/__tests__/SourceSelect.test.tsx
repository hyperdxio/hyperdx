import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SourceManagementMenu } from '../SourceSelect';

describe('SourceManagementMenu', () => {
  it('returns null when no actions are wired', () => {
    const { container } = renderWithMantine(
      <SourceManagementMenu hasSelection={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the kebab trigger when onSchemaPreview is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onSchemaPreview={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  it('renders the kebab trigger when only onEdit is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onEdit={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  it('renders the kebab trigger when only onCreate is wired', () => {
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onCreate={jest.fn()} />,
    );
    expect(screen.getByTestId('source-actions-menu')).toBeInTheDocument();
  });

  describe('View schema item', () => {
    it('is disabled when hasSelection is false', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection={false}
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      expect(
        screen.getByText('View schema').closest('button'),
      ).toHaveAttribute('data-disabled', 'true');
    });

    it('is disabled when isSchemaPreviewEnabled is false', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled={false}
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      expect(
        screen.getByText('View schema').closest('button'),
      ).toHaveAttribute('data-disabled', 'true');
    });

    it('is enabled when hasSelection and isSchemaPreviewEnabled are both true', async () => {
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={jest.fn()}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      expect(
        screen.getByText('View schema').closest('button'),
      ).not.toHaveAttribute('data-disabled');
    });

    it('calls onSchemaPreview when clicked', async () => {
      const onSchemaPreview = jest.fn();
      renderWithMantine(
        <SourceManagementMenu
          hasSelection
          onSchemaPreview={onSchemaPreview}
          isSchemaPreviewEnabled
        />,
      );
      await userEvent.click(screen.getByTestId('source-actions-menu'));
      await userEvent.click(screen.getByText('View schema'));
      expect(onSchemaPreview).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onEdit when Edit sources is clicked', async () => {
    const onEdit = jest.fn();
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onEdit={onEdit} />,
    );
    await userEvent.click(screen.getByTestId('source-actions-menu'));
    await userEvent.click(screen.getByText('Edit sources'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('calls onCreate when Create new source is clicked', async () => {
    const onCreate = jest.fn();
    renderWithMantine(
      <SourceManagementMenu hasSelection={false} onCreate={onCreate} />,
    );
    await userEvent.click(screen.getByTestId('source-actions-menu'));
    await userEvent.click(screen.getByText('Create new source'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
