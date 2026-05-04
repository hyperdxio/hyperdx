import { Group, Stack } from '@mantine/core';

interface ChartContainerProps {
  title?: React.ReactNode;
  toolbarItems?: React.ReactNode[];
  children: React.ReactNode;
  disableReactiveContainer?: boolean;
}

function ChartContainer({
  title,
  toolbarItems,
  children,
  disableReactiveContainer,
}: ChartContainerProps) {
  return (
    <Stack h="100%" w="100%" style={{ flexGrow: 1 }}>
      {(!!title || !!toolbarItems?.length) && (
        <Group justify="space-between" align="start" wrap="nowrap">
          <span
            style={{
              flex: 1,
              flexShrink: 1,
              overflow: 'hidden',
            }}
          >
            {title}
          </span>
          {toolbarItems && (
            <Group flex={0} wrap="nowrap" gap={5}>
              {toolbarItems}
            </Group>
          )}
        </Group>
      )}
      {disableReactiveContainer ? (
        children
      ) : (
        <div
          // Hack, recharts will release real fix soon https://github.com/recharts/recharts/issues/172
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
            }}
          >
            {children}
          </div>
        </div>
      )}
    </Stack>
  );
}

export default ChartContainer;
