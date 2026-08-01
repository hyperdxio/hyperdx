import { Group, InputLabel, Tooltip } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';

export function InputLabelWithTooltip({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  return (
    <Group gap="xs" align="center" mb={4}>
      <InputLabel mb={0}>{label}</InputLabel>
      <Tooltip label={tooltip}>
        <IconHelpCircle size={16} className="cursor-pointer" />
      </Tooltip>
    </Group>
  );
}
