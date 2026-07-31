import { Control, useWatch } from 'react-hook-form';
import { Button } from '@mantine/core';

import { ChartEditorFormState } from '@/components/ChartEditor/types';

interface OnClickFormButtonProps {
  control: Control<ChartEditorFormState>;
  /** Opens the Row Click Action section in the docked tile settings rail. */
  onOpen: () => void;
}

export function OnClickFormButton({ control, onOpen }: OnClickFormButtonProps) {
  const onClickValue = useWatch({ control, name: 'onClick' });
  const onClickTypeLabel =
    onClickValue?.type === 'search'
      ? 'Search'
      : onClickValue?.type === 'dashboard'
        ? 'Dashboard'
        : onClickValue?.type === 'external'
          ? 'External'
          : 'Default';

  return (
    <Button
      onClick={onOpen}
      size="compact-sm"
      variant="secondary"
      data-testid="onclick-drawer-trigger"
    >
      Row Click Action: {onClickTypeLabel}
    </Button>
  );
}
