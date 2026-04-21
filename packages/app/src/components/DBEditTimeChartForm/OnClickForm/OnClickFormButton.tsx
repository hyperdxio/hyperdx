import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { IS_DASHBOARD_LINKING_ENABLED } from '@/config';

import OnClickDrawer from './OnClickDrawer';

interface OnClickFormButtonProps {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
}

export function OnClickFormButton({
  control,
  setValue,
}: OnClickFormButtonProps) {
  const [
    onClickDrawerOpened,
    { open: openOnClickDrawer, close: closeOnClickDrawer },
  ] = useDisclosure(false);

  const onClickValue = useWatch({ control, name: 'onClick' });
  const onClickTypeLabel =
    onClickValue?.type === 'search' ? 'Search' : 'Default';

  // TODO: Remove once feature flag is permanently enabled
  if (!IS_DASHBOARD_LINKING_ENABLED) {
    return null;
  }

  return (
    <>
      <Button
        onClick={openOnClickDrawer}
        size="compact-sm"
        variant="secondary"
        data-testid="onclick-drawer-trigger"
      >
        Row Click Action: {onClickTypeLabel}
      </Button>
      <OnClickDrawer
        opened={onClickDrawerOpened}
        value={onClickValue}
        onChange={value => {
          setValue('onClick', value, { shouldDirty: true });
        }}
        onClose={closeOnClickDrawer}
      />
    </>
  );
}
