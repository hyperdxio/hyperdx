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
        background:
          'linear-gradient(180deg, rgba(250,250,250,0.018) 0%, rgba(250,250,250,0.008) 100%)',
        borderRadius: 2,
        ...style,
      }}
    >
      {children}
    </Box>
  );
}
