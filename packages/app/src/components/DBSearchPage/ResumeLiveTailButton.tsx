import { Button } from '@mantine/core';
import { IconBolt } from '@tabler/icons-react';

import { useAppTheme } from '@/theme/ThemeProvider';

type ResumeLiveTailButtonProps = {
  handleResumeLiveTail: () => void;
};

export function ResumeLiveTailButton({
  handleResumeLiveTail,
}: ResumeLiveTailButtonProps) {
  const { themeName } = useAppTheme();
  const variant = themeName === 'clickstack' ? 'secondary' : 'primary';

  return (
    <Button
      size="compact-xs"
      variant={variant}
      onClick={handleResumeLiveTail}
      leftSection={<IconBolt size={14} />}
    >
      Resume Live Tail
    </Button>
  );
}
