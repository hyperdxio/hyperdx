import React from 'react';
import {
  ActionIcon,
  Button,
  ColorInput,
  ColorSwatch,
  Group,
  Popover,
  SimpleGrid,
  Text,
} from '@mantine/core';

// Different from auto colors, TBD
const COLOR_PRESETS = [
  '#e60049',
  '#0bb4ff',
  '#50e991',
  '#e6d800',
  '#9b19f5',
  '#ffa300',
  '#dc0ab4',
  '#b3d4ff',
  '#00bfa0',
];

const Z_INDEX = 9999;

export const ColorSwatchInput = ({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (value?: string) => void;
}) => {
  const [opened, setOpened] = React.useState(false);

  const handleChange = (color?: string) => {
    onChange?.(color);
    setOpened(false);
  };

  return (
    <Popover
      position="bottom"
      shadow="md"
      opened={opened}
      onChange={setOpened}
      closeOnClickOutside={false}
    >
      <Popover.Target>
        <Button
          size="compact-xs"
          variant="light"
          color="gray"
          bg="gray.8"
          onClick={() => setOpened(o => !o)}
        >
          {value ? (
            <Group gap="xs">
              <Text size="xs" c="gray.5">
                Color
              </Text>
              <ColorSwatch color={value} size={14} />
            </Group>
          ) : (
            <Text size="xs" c="gray.5">
              Choose color
            </Text>
          )}
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs" style={{ zIndex: Z_INDEX }}>
        <ColorInput
          size="xs"
          value={value}
          onChange={color => onChange?.(color)}
          placeholder="#000000"
          radius="md"
          variant="filled"
          w="130"
          onBlur={() => setOpened(false)}
          popoverProps={{
            zIndex: Z_INDEX + 1,
            closeOnClickOutside: false,
          }}
        />
        <SimpleGrid cols={4} spacing={0} verticalSpacing={0} my="xs">
          {COLOR_PRESETS.map(color => (
            <ActionIcon
              key={color}
              size="md"
              variant={value === color ? 'filled' : 'subtle'}
              color="gray"
              onClick={() => handleChange(color)}
            >
              <ColorSwatch color={color} size={14} />
            </ActionIcon>
          ))}
        </SimpleGrid>
        {value && (
          <Button size="compact-xs" color="gray" onClick={() => handleChange()}>
            Clear
          </Button>
        )}
      </Popover.Dropdown>
    </Popover>
  );
};
