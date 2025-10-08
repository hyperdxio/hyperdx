import { memo, useMemo } from 'react';
import { UseControllerProps } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { SelectProps, UnstyledButton } from '@mantine/core';
import { ComboboxChevron } from '@mantine/core';

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
          onClick={e => {
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
      ...(data
        ?.filter(
          source =>
            !allowedSourceKinds || allowedSourceKinds.includes(source.kind),
        )
        .map(d => ({
          value: d.id,
          label: d.name,
        })) ?? []),
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
      leftSection={<i className="bi bi-collection"></i>}
      maxDropdownHeight={280}
      size={size}
      onCreate={onCreate}
      {...rightSectionProps}
    />
  );
}

export const SourceSelectControlled = memo(SourceSelectControlledComponent);
