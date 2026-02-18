import { memo, useMemo } from 'react';
import { useController, UseControllerProps } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ComboboxChevron,
  MultiSelect,
  MultiSelectProps,
  SelectProps,
  UnstyledButton,
} from '@mantine/core';
import { IconStack } from '@tabler/icons-react';

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

function SourceSelectControlledComponent({
  size,
  onCreate,
  allowedSourceKinds,
  comboboxProps,
  sourceSchemaPreview,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  allowedSourceKinds?: SourceKind[];
  sourceSchemaPreview?: React.ReactNode;
} & UseControllerProps<any> &
  SelectProps) {
  const { data } = useSources();
  const hasLocalDefaultSources = !!HDX_LOCAL_DEFAULT_SOURCES;

  const values = useMemo(
    () => [
      ...(
        data
          ?.filter(
            source =>
              !allowedSourceKinds || allowedSourceKinds.includes(source.kind),
          )
          .map(d => ({
            value: d.id,
            label: d.name,
          })) ?? []
      ).sort((a, b) => a.label.localeCompare(b.label)),
      ...(onCreate && !hasLocalDefaultSources
        ? [
            {
              value: '_create_new_value',
              label: 'Create New Source',
            },
          ]
        : []),
    ],
    [data, onCreate, allowedSourceKinds, hasLocalDefaultSources],
  );

  const rightSectionProps = SourceSelectRightSection({ sourceSchemaPreview });

  return (
    <SelectControlled
      {...props}
      data={values}
      // disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: false, ...comboboxProps }}
      searchable
      placeholder="Data Source"
      leftSection={<IconStack size={16} />}
      maxDropdownHeight={280}
      size={size}
      onCreate={onCreate}
      {...rightSectionProps}
    />
  );
}

export const SourceSelectControlled = memo(SourceSelectControlledComponent);

/** Multi-select for search page: allows selecting multiple sources (logs + traces). */
function SourceMultiSelectControlledComponent({
  size,
  onCreate,
  allowedSourceKinds,
  ...props
}: {
  size?: string;
  onCreate?: () => void;
  allowedSourceKinds?: SourceKind[];
} & UseControllerProps<any> &
  Omit<MultiSelectProps, 'data'>) {
  const {
    field: { value: fieldValue, onChange: fieldOnChange, onBlur, name, ref },
    fieldState,
  } = useController(props);
  const { data } = useSources();
  const hasLocalDefaultSources = !!HDX_LOCAL_DEFAULT_SOURCES;

  const dataOptions = useMemo(
    () =>
      [
        ...(
          data
            ?.filter(
              source =>
                !allowedSourceKinds || allowedSourceKinds.includes(source.kind),
            )
            .map(d => ({ value: d.id, label: d.name })) ?? []
        ).sort((a, b) => a.label.localeCompare(b.label)),
        ...(onCreate && !hasLocalDefaultSources
          ? [{ value: '_create_new_value', label: 'Create New Source' }]
          : []),
      ] as { value: string; label: string }[],
    [data, allowedSourceKinds, onCreate, hasLocalDefaultSources],
  );

  const selectedValues = Array.isArray(fieldValue) ? fieldValue : [];
  const handleChange = (v: string[]) => {
    if (v.includes('_create_new_value') && onCreate) {
      onCreate();
      fieldOnChange(selectedValues);
      return;
    }
    if (v.length === 0) return;
    fieldOnChange(v);
  };

  return (
    <MultiSelect
      {...props}
      ref={ref}
      name={name}
      data={dataOptions}
      value={selectedValues}
      onChange={handleChange}
      onBlur={onBlur}
      error={fieldState.error?.message}
      placeholder="Data sources"
      leftSection={<IconStack size={16} />}
      size={size ?? 'xs'}
      searchable
      clearable
      maxDropdownHeight={280}
      comboboxProps={{ withinPortal: false }}
    />
  );
}

export const SourceMultiSelectControlled = memo(
  SourceMultiSelectControlledComponent,
);
