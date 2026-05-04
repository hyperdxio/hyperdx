import { Box, BoxComponentProps } from '@mantine/core';

export function ChartBox({
  children,
  style,
  'data-testid': dataTestId,
}: {
  children: React.ReactNode;
  style?: BoxComponentProps['style'];
  'data-testid'?: string;
}) {
  return (
    <Box
      py="sm"
      px="xs"
      data-testid={dataTestId}
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
