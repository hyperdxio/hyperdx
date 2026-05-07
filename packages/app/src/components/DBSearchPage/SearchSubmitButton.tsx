import { Button } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';

type SearchSubmitButtonProps = {
  isFormStateDirty: boolean;
};

export function SearchSubmitButton({
  isFormStateDirty,
}: SearchSubmitButtonProps) {
  return (
    <Button
      data-testid="search-submit-button"
      variant={isFormStateDirty ? 'primary' : 'secondary'}
      type="submit"
      leftSection={<IconPlayerPlay size={16} />}
      style={{ flexShrink: 0 }}
    >
      Run
    </Button>
  );
}
