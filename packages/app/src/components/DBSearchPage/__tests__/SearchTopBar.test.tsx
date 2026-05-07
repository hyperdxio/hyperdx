import React from 'react';
import { useForm } from 'react-hook-form';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchTopBar } from '../SearchTopBar';
import { SearchConfigFromSchema } from '../utils';

jest.mock('@/components/SourceSelect', () => ({
  SourceSelectControlled: () => <div data-testid="source-select-stub" />,
}));

jest.mock('@/components/SQLEditor/SQLInlineEditor', () => ({
  SQLInlineEditorControlled: ({ name }: { name: string }) => (
    <div data-testid={`sql-editor-${name}`} />
  ),
}));

const noop = () => {};

function HarnessForm({
  savedSearchId,
  hideAlerts,
  onSubmit = noop,
  onSaveSearch = noop,
  onUpdateSearch = noop,
  onOpenAlertModal = noop,
}: {
  savedSearchId: string | null;
  hideAlerts: boolean;
  onSubmit?: () => void;
  onSaveSearch?: () => void;
  onUpdateSearch?: () => void;
  onOpenAlertModal?: () => void;
}) {
  const { control } = useForm<SearchConfigFromSchema>({
    defaultValues: {
      select: '',
      source: '',
      where: '',
      whereLanguage: 'lucene',
      orderBy: '',
      filters: [],
    },
  });

  return (
    <SearchTopBar
      control={control}
      savedSearchId={savedSearchId}
      inputSourceTableConnection={undefined}
      defaultSelect=""
      defaultOrderBy={undefined}
      sourceSchemaPreview={null}
      hideAlerts={hideAlerts}
      onCreateSource={jest.fn()}
      onEditSources={jest.fn()}
      onSubmit={onSubmit}
      onSaveSearch={onSaveSearch}
      onUpdateSearch={onUpdateSearch}
      onOpenAlertModal={onOpenAlertModal}
    />
  );
}

describe('SearchTopBar', () => {
  it('shows Save button when there is no saved search', () => {
    renderWithMantine(<HarnessForm savedSearchId={null} hideAlerts={false} />);
    expect(screen.getByTestId('save-search-button')).toBeInTheDocument();
    expect(screen.queryByTestId('update-search-button')).toBeNull();
  });

  it('shows Update button when on a saved search', () => {
    renderWithMantine(
      <HarnessForm savedSearchId="search-123" hideAlerts={false} />,
    );
    expect(screen.getByTestId('update-search-button')).toBeInTheDocument();
    expect(screen.queryByTestId('save-search-button')).toBeNull();
  });

  it('hides the Alerts button in local mode', () => {
    renderWithMantine(<HarnessForm savedSearchId="search-123" hideAlerts />);
    expect(screen.queryByTestId('alerts-button')).toBeNull();
  });

  it('shows the Alerts button outside local mode', () => {
    renderWithMantine(<HarnessForm savedSearchId={null} hideAlerts={false} />);
    expect(screen.getByTestId('alerts-button')).toBeInTheDocument();
  });

  it('invokes the save callback when Save is clicked', async () => {
    const onSaveSearch = jest.fn();
    renderWithMantine(
      <HarnessForm
        savedSearchId={null}
        hideAlerts
        onSaveSearch={onSaveSearch}
      />,
    );
    await userEvent.click(screen.getByTestId('save-search-button'));
    expect(onSaveSearch).toHaveBeenCalledTimes(1);
  });

  it('invokes the update callback when Update is clicked', async () => {
    const onUpdateSearch = jest.fn();
    renderWithMantine(
      <HarnessForm
        savedSearchId="search-1"
        hideAlerts
        onUpdateSearch={onUpdateSearch}
      />,
    );
    await userEvent.click(screen.getByTestId('update-search-button'));
    expect(onUpdateSearch).toHaveBeenCalledTimes(1);
  });

  it('invokes the alerts callback when Alerts is clicked', async () => {
    const onOpenAlertModal = jest.fn();
    renderWithMantine(
      <HarnessForm
        savedSearchId="search-1"
        hideAlerts={false}
        onOpenAlertModal={onOpenAlertModal}
      />,
    );
    await userEvent.click(screen.getByTestId('alerts-button'));
    expect(onOpenAlertModal).toHaveBeenCalledTimes(1);
  });
});
