import { memo, useCallback, useMemo } from 'react';
import { UseControllerProps, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  ComboboxChevron,
  ComboboxItem,
  Group,
  Menu,
  SelectProps,
  Tooltip,
} from '@mantine/core';
import {
  IconCode,
  IconDotsVertical,
  IconPencil,
  IconPlus,
  IconSettings,
  IconStack,
} from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
import {
  SOURCE_KIND_ICONS,
  useFilteredSortedSourceItems,
  useSourceKindMap,
} from '@/components/sourceSelectUtils';
import { useSources } from '@/source';

import styles from '../../styles/SourceSelectControlled.module.scss';

interface SourceManagementMenuProps {
  hasSelection: boolean;
  onSchemaPreview?: () => void;
  isSchemaPreviewEnabled?: boolean;
  /**
   * Open the edit form for the currently selected source. Should act
   * on `hasSelection ? currentSourceId : null`. Hidden from the menu
   * when no handler is passed.
   */
  onEdit?: () => void;
  /**
   * Open the list view of all sources (e.g. `/team#sources`). Hidden
   * from the menu when no handler is passed; typically the case in
   * local mode where no list-view surface exists.
   */
  onManageSources?: () => void;
  onCreate?: () => void;
}

/**
 * Adjacent kebab menu that consolidates source-management actions:
 * View schema, Edit source, Manage sources, Create new source.
 *
 * `Edit source` operates on the current selection; `Manage sources`
 * opens the all-sources list view. Each item hides if its handler
 * isn't wired, so callers can pick the right combination for their
 * surface (local mode, for example, has no list view and should leave
 * `onManageSources` unset).
 *
 * Exposed so non-`SourceSelectControlled` callers (e.g. `DBTableSelect`)
 * can attach the same surface if needed.
 */
export const SourceManagementMenu = ({
  hasSelection,
  onSchemaPreview,
  isSchemaPreviewEnabled = true,
  onEdit,
  onManageSources,
  onCreate,
}: SourceManagementMenuProps) => {
  const items: React.ReactNode[] = [];

  if (onSchemaPreview) {
    items.push(
      <Menu.Item
        key="view-schema"
        leftSection={<IconCode size={14} />}
        onClick={onSchemaPreview}
        disabled={!hasSelection || !isSchemaPreviewEnabled}
      >
        View schema
      </Menu.Item>,
    );
  }

  if (onEdit) {
    items.push(
      <Menu.Item
        key="edit-source"
        leftSection={<IconPencil size={14} />}
        onClick={onEdit}
        disabled={!hasSelection}
      >
        Edit source
      </Menu.Item>,
    );
  }

  if (onManageSources) {
    items.push(
      <Menu.Item
        key="manage-sources"
        leftSection={<IconSettings size={14} />}
        onClick={onManageSources}
      >
        Manage sources
      </Menu.Item>,
    );
  }

  if (onCreate) {
    if (items.length > 0) {
      items.push(<Menu.Divider key="divider-create" />);
    }
    items.push(
      <Menu.Item
        key="create-new-source"
        leftSection={<IconPlus size={14} />}
        onClick={onCreate}
      >
        Create new source
      </Menu.Item>,
    );
  }

  if (items.length === 0) return null;

  return (
    <Menu width={220} withinPortal position="bottom-end">
      <Menu.Target>
        <Tooltip label="Source actions" color="dark" position="top">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="input-xs"
            className={styles.sourceMenuButton}
            data-testid="source-actions-menu"
            aria-label="Source actions"
          >
            <IconDotsVertical size={14} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>{items}</Menu.Dropdown>
    </Menu>
  );
};

function SourceSelectControlledComponent({
  size,
  onCreate,
  onEdit,
  onManageSources,
  onSchemaPreview,
  isSchemaPreviewEnabled,
  allowedSourceKinds,
  connectionId,
  comboboxProps,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  onEdit?: () => void;
  onManageSources?: () => void;
  onSchemaPreview?: () => void;
  isSchemaPreviewEnabled?: boolean;
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
} & UseControllerProps<any> &
  SelectProps) {
  const { data } = useSources();
  const selectedSourceId = useWatch({
    control: props.control,
    name: props.name,
  });

  const selectedSourceKind = useMemo(
    () => data?.find(s => s.id === selectedSourceId)?.kind,
    [data, selectedSourceId],
  );

  const leftIcon = SOURCE_KIND_ICONS[selectedSourceKind ?? ''] ?? (
    <IconStack size={16} />
  );

  const sourceKindMap = useSourceKindMap(data);

  const renderOption = useCallback(
    ({ option }: { option: ComboboxItem }) => {
      const icon = SOURCE_KIND_ICONS[sourceKindMap.get(option.value) ?? ''];
      if (!icon) return option.label;
      return (
        <Group gap="xs" wrap="nowrap">
          {icon}
          {option.label}
        </Group>
      );
    },
    [sourceKindMap],
  );

  const sourceItems = useFilteredSortedSourceItems({
    sources: data,
    allowedSourceKinds,
    connectionId,
  });

  const hasSelection = !!selectedSourceId;
  const hasMenu =
    !!onCreate || !!onEdit || !!onManageSources || !!onSchemaPreview;

  return (
    <Group
      gap={4}
      wrap="nowrap"
      className={styles.sourceSelectGroup}
      data-with-menu={hasMenu || undefined}
    >
      <SelectControlled
        {...props}
        data={sourceItems}
        comboboxProps={{ withinPortal: false, ...comboboxProps }}
        classNames={{
          input: styles.sourceSelectInput,
          groupLabel: styles.groupLabel,
        }}
        renderOption={renderOption}
        searchable
        placeholder="Data Source"
        leftSection={leftIcon}
        maxDropdownHeight={280}
        size={size}
        rightSection={<ComboboxChevron />}
      />
      {hasMenu && (
        <SourceManagementMenu
          hasSelection={hasSelection}
          onSchemaPreview={onSchemaPreview}
          isSchemaPreviewEnabled={isSchemaPreviewEnabled}
          onEdit={onEdit}
          onManageSources={onManageSources}
          onCreate={onCreate}
        />
      )}
    </Group>
  );
}

export const SourceSelectControlled = memo(SourceSelectControlledComponent);
