import { memo, useCallback, useMemo } from 'react';
import { UseControllerProps, useWatch } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ComboboxChevron,
  ComboboxItem,
  Group,
  SelectProps,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChartLine,
  IconConnection,
  IconDeviceLaptop,
  IconLogs,
  IconPlus,
  IconSettings,
  IconStack,
} from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
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
  [SourceKind.Log]: <IconLogs size={16} />,
  [SourceKind.Trace]: <IconConnection size={16} />,
  [SourceKind.Session]: <IconDeviceLaptop size={16} />,
  [SourceKind.Metric]: <IconChartLine size={16} />,
};

const OPTION_ICONS: Record<string, React.ReactNode> = {
  _create_new_value: <IconPlus size={14} />,
  _edit_sources_value: <IconSettings size={14} />,
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

  const sourceKindMap = useMemo(() => {
    const map = new Map<string, SourceKind>();
    data?.forEach(s => map.set(s.id, s.kind));
    return map;
  }, [data]);

  const renderOption = useCallback(
    ({ option }: { option: ComboboxItem }) => {
      const icon =
        OPTION_ICONS[option.value] ??
        SOURCE_KIND_ICONS[sourceKindMap.get(option.value) ?? ''];
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

  const hasActions = !!onCreate || !!onEdit;

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
    if (onCreate) {
      actionItems.push({
        value: '_create_new_value',
        label: 'Create New Source',
      });
    }
    if (onEdit) {
      actionItems.push({ value: '_edit_sources_value', label: 'Edit Sources' });
    }

    return [...sourceItems, { group: 'Actions', items: actionItems }];
  }, [data, onCreate, onEdit, allowedSourceKinds, connectionId, hasActions]);

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
