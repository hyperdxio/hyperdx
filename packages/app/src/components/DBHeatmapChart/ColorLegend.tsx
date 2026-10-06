import { Flex, Text } from '@mantine/core';

type ColorLegendProps = {
  colors: string[];
};

export function ColorLegend({ colors }: ColorLegendProps) {
  return (
    <Flex
      align="center"
      gap={4}
      role="img"
      aria-label="Color scale: low to high count"
    >
      <Text size="10px" c="dimmed">
        Low
      </Text>
      <div
        style={{
          display: 'flex',
          width: 80,
          height: 8,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {colors.map(color => (
          <div key={color} style={{ flex: 1, background: color }} />
        ))}
      </div>
      <Text size="10px" c="dimmed">
        High
      </Text>
    </Flex>
  );
}
