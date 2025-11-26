import { Box, BoxComponentProps } from '@mantine/core';

export function ChartBox({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: BoxComponentProps['style'];
}) {
  return (
    <Box
      py="sm"
      px="xs"
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-body)',
        borderRadius: 'var(--mantine-radius-sm)',
        border: '1px solid var(--color-border)',
        ...style,
      }}
    >
      {children}
    </Box>
  );
}
