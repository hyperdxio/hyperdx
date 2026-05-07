import { Trans } from 'next-i18next/pages';
import { Control, UseFormSetValue, useWatch } from 'react-hook-form';
import { Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { IS_DASHBOARD_LINKING_ENABLED } from '@/config';

import OnClickDrawer from './OnClickDrawer';

interface OnClickFormButtonProps {
  control: Control<ChartEditorFormState>;
  setValue: UseFormSetValue<ChartEditorFormState>;
  onSubmit?: (suppressErrorNotification?: boolean) => void;
}

export function OnClickFormButton({
  control,
  setValue,
  onSubmit,
}: OnClickFormButtonProps) {
  const [
    onClickDrawerOpened,
    { open: openOnClickDrawer, close: closeOnClickDrawer },
  ] = useDisclosure(false);

  const onClickValue = useWatch({ control, name: 'onClick' });
  const onClickTypeLabel =
    onClickValue?.type === 'search'
      ? 'Search'
      : onClickValue?.type === 'dashboard'
        ? 'Dashboard'
        : 'Default';

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
        <Trans>Row Click Action:</Trans> {onClickTypeLabel}
      </Button>
      <OnClickDrawer
        opened={onClickDrawerOpened}
        value={onClickValue}
        onChange={value => {
          setValue('onClick', value, { shouldDirty: true });
          onSubmit?.();
        }}
        onClose={closeOnClickDrawer}
      />
    </>
  );
}
