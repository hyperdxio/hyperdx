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
import { IconPlus, IconSettings, IconStack } from '@tabler/icons-react';

import SelectControlled, {
  SelectControlledSpecialValues,
} from '@/components/SelectControlled';
import {
  SOURCE_KIND_ICONS,
  useFilteredSortedSourceItems,
  useSourceKindMap,
} from '@/components/sourceSelectUtils';
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

const OPTION_ICONS: Record<string, React.ReactNode> = {
  [SelectControlledSpecialValues.CreateNewValue]: <IconPlus size={14} />,
  [SelectControlledSpecialValues.EditValue]: <IconSettings size={14} />,
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

  const sourceKindMap = useSourceKindMap(data);

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

  const sourceItems = useFilteredSortedSourceItems({
    sources: data,
    allowedSourceKinds,
    connectionId,
  });

  const values = useMemo(() => {
    if (!hasActions) {
      return sourceItems;
    }

    const actionItems: { value: string; label: string }[] = [];
    if (onCreate) {
      actionItems.push({
        value: SelectControlledSpecialValues.CreateNewValue,
        label: 'Create New Source',
      });
    }
    if (onEdit) {
      actionItems.push({
        value: SelectControlledSpecialValues.EditValue,
        label: 'Edit Sources',
      });
    }

    return [...sourceItems, { group: 'Actions', items: actionItems }];
  }, [sourceItems, onCreate, onEdit, hasActions]);

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
