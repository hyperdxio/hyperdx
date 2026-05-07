import { ReactNode } from 'react';
import { Control } from 'react-hook-form';
import { TableConnection } from '@hyperdx/common-utils/dist/core/metadata';
import { Box, Button, Flex } from '@mantine/core';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { SQLInlineEditorControlled } from '@/components/SQLEditor/SQLInlineEditor';

import { ALLOWED_SOURCE_KINDS, SearchConfigFromSchema } from './utils';

type SearchTopBarProps = {
  control: Control<SearchConfigFromSchema>;
  savedSearchId: string | null;
  inputSourceTableConnection: TableConnection | undefined;
  defaultSelect: string | undefined;
  defaultOrderBy: string | undefined;
  sourceSchemaPreview: ReactNode;
  hideAlerts: boolean;
  onCreateSource: () => void;
  onEditSources: () => void;
  onSubmit: () => void;
  onSaveSearch: () => void;
  onUpdateSearch: () => void;
  onOpenAlertModal: () => void;
};

export function SearchTopBar({
  control,
  savedSearchId,
  inputSourceTableConnection,
  defaultSelect,
  defaultOrderBy,
  sourceSchemaPreview,
  hideAlerts,
  onCreateSource,
  onEditSources,
  onSubmit,
  onSaveSearch,
  onUpdateSearch,
  onOpenAlertModal,
}: SearchTopBarProps) {
  return (
    <Flex gap="sm" px="sm" pt="sm" wrap="nowrap">
      <SourceSelectControlled
        key={`${savedSearchId}`}
        size="xs"
        control={control}
        name="source"
        onCreate={onCreateSource}
        onEdit={onEditSources}
        allowedSourceKinds={ALLOWED_SOURCE_KINDS}
        data-testid="source-selector"
        sourceSchemaPreview={sourceSchemaPreview}
        style={{ minWidth: 150 }}
      />
      <Box style={{ flex: '1 1 0%', minWidth: 100 }}>
        <SQLInlineEditorControlled
          tableConnection={inputSourceTableConnection}
          control={control}
          name="select"
          defaultValue={defaultSelect}
          placeholder={defaultSelect || 'SELECT Columns'}
          onSubmit={onSubmit}
          label="SELECT"
          size="xs"
          allowMultiline
        />
      </Box>
      <Box style={{ maxWidth: 400, width: '20%' }}>
        <SQLInlineEditorControlled
          tableConnection={inputSourceTableConnection}
          control={control}
          name="orderBy"
          defaultValue={defaultOrderBy}
          onSubmit={onSubmit}
          label="ORDER BY"
          size="xs"
        />
      </Box>
      {!savedSearchId ? (
        <Button
          data-testid="save-search-button"
          variant="secondary"
          size="xs"
          onClick={onSaveSearch}
          style={{ flexShrink: 0 }}
        >
          Save
        </Button>
      ) : (
        <Button
          data-testid="update-search-button"
          variant="secondary"
          size="xs"
          onClick={onUpdateSearch}
          style={{ flexShrink: 0 }}
        >
          Update
        </Button>
      )}
      {!hideAlerts && (
        <Button
          data-testid="alerts-button"
          variant="secondary"
          size="xs"
          onClick={onOpenAlertModal}
          style={{ flexShrink: 0 }}
        >
          Alerts
        </Button>
      )}
    </Flex>
  );
}
