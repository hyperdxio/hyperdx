import { memo, useCallback, useMemo } from 'react';
import { UseControllerProps, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Group, SelectProps, UnstyledButton } from '@mantine/core';
import { ComboboxChevron } from '@mantine/core';
import {
  IconConnection,
  IconLogs,
  IconPlus,
  IconSettings,
  IconStack,
} from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
import { HDX_LOCAL_DEFAULT_SOURCES } from '@/config';
import { useSources } from '@/source';

import styles from '../../styles/SourceSelectControlled.module.scss';

interface SourceSelectRightSectionProps {
  sourceSchemaPreview?: React.ReactNode;
}

export const SourceSelectRightSection = ({
  sourceSchemaPreview,
}: SourceSelectRightSectionProps) => {
  if (!sourceSchemaPreview) {
    return {
      rightSection: <ComboboxChevron />,
    };
  }

  return {
    rightSection: (
      <>
        <UnstyledButton
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className={styles.sourceSchemaPreviewButton}
        >
          {sourceSchemaPreview}
        </UnstyledButton>
        <ComboboxChevron />
      </>
    ),
    rightSectionWidth: 70,
  };
};

const SOURCE_KIND_ICONS: Record<string, React.ReactNode> = {
  [SourceKind.Trace]: <IconConnection size={16} />,
  [SourceKind.Log]: <IconLogs size={16} />,
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  _create_new_value: <IconPlus size={14} />,
  _edit_sources_value: <IconSettings size={14} />,
};

const renderOption: SelectProps['renderOption'] = ({ option, checked }) => {
  const icon = ACTION_ICONS[option.value];
  if (!icon) return option.label;
  return (
    <Group gap="xs" wrap="nowrap">
      {icon}
      {option.label}
    </Group>
  );
};

function SourceSelectControlledComponent({
  size,
  onCreate,
  onEdit,
  allowedSourceKinds,
  connectionId,
  comboboxProps,
  sourceSchemaPreview,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  onEdit?: () => void;
  allowedSourceKinds?: SourceKind[];
  connectionId?: string;
  sourceSchemaPreview?: React.ReactNode;
} & UseControllerProps<any> &
  SelectProps) {
  const { data } = useSources();
  const hasLocalDefaultSources = !!HDX_LOCAL_DEFAULT_SOURCES;

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

  const hasActions =
    (onCreate && !hasLocalDefaultSources) ||
    (onEdit && !hasLocalDefaultSources);

  const values = useMemo(() => {
    const sourceItems = (
      data
        ?.filter(
          source =>
            (!allowedSourceKinds || allowedSourceKinds.includes(source.kind)) &&
            (!connectionId || source.connection === connectionId),
        )
        .map(d => ({
          value: d.id,
          label: d.name,
        })) ?? []
    ).sort((a, b) => a.label.localeCompare(b.label));

    if (!hasActions) {
      return sourceItems;
    }

    const actionItems: { value: string; label: string }[] = [];
    if (onCreate && !hasLocalDefaultSources) {
      actionItems.push({
        value: '_create_new_value',
        label: 'Create New Source',
      });
    }
    if (onEdit && !hasLocalDefaultSources) {
      actionItems.push({ value: '_edit_sources_value', label: 'Edit Sources' });
    }

    return [...sourceItems, { group: 'Actions', items: actionItems }];
  }, [
    data,
    onCreate,
    onEdit,
    allowedSourceKinds,
    connectionId,
    hasLocalDefaultSources,
    hasActions,
  ]);

  const rightSectionProps = SourceSelectRightSection({ sourceSchemaPreview });

  return (
    <SelectControlled
      {...props}
      data={values}
      comboboxProps={{ withinPortal: false, ...comboboxProps }}
      classNames={{ groupLabel: styles.groupLabel }}
      renderOption={renderOption}
      searchable
      placeholder="Data Source"
      leftSection={leftIcon}
      maxDropdownHeight={280}
      size={size}
      onCreate={onCreate}
      onEdit={onEdit}
      {...rightSectionProps}
    />
  );
}

export const SourceSelectControlled = memo(SourceSelectControlledComponent);
