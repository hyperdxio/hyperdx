import { memo, useCallback, useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';
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
  comboboxProps,
  sourceSchemaPreview,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  onEdit?: () => void;
  /**
   * @deprecated Berg has a single Source kind (`Table`); kind-based filtering
   * is a no-op and retained only so legacy call sites still type-check.
   */
  allowedSourceKinds?: unknown;
  /**
   * @deprecated Connections are no longer modelled in Berg. Retained as an
   * inert prop so legacy call sites still type-check.
   */
  connectionId?: string;
  sourceSchemaPreview?: React.ReactNode;
} & UseControllerProps<any> &
  SelectProps) {
  const { data } = useSources();

  const renderOption = useCallback(({ option }: { option: ComboboxItem }) => {
    const icon = OPTION_ICONS[option.value] ?? <IconStack size={14} />;
    return (
      <Group gap="xs" wrap="nowrap">
        {icon}
        {option.label}
      </Group>
    );
  }, []);

  const hasActions = !!onCreate || !!onEdit;

  const values = useMemo(() => {
    const sourceItems = (
      data?.map(d => ({
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
  }, [data, onCreate, onEdit, hasActions]);

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
      leftSection={<IconStack size={16} />}
      maxDropdownHeight={280}
      size={size}
      onCreate={onCreate}
      onEdit={onEdit}
      {...rightSectionProps}
    />
  );
}

export const SourceSelectControlled = memo(SourceSelectControlledComponent);
