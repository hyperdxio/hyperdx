import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
} from '@mantine/core';

import { SOURCE_KIND_ICONS } from '@/components/sourceSelectUtils';
import { IconAiNotebook, IncidentIOIcon } from '@/SVGIcons';

import { AssetCard } from './AssetCard';

const story = {
  title: 'Icons/Custom icons',
  parameters: {
    layout: 'padded',
  },
};
export default story;

const TABLER_USAGE = `import { IconAiNotebook } from '@/SVGIcons';

<Button leftSection={<IconAiNotebook size={16} />}>AI notebooks</Button>
<ActionIcon variant="subtle" aria-label="AI notebooks">
  <IconAiNotebook size={16} />
</ActionIcon>`;

const BRAND_USAGE = `import { IncidentIOIcon } from '@/SVGIcons';

<IncidentIOIcon width={16} />`;

export const Gallery = () => (
  <Stack gap="xl" maw={800}>
    <div>
      <Text size="lg" fw={700}>
        Custom icons
      </Text>
      <Text size="sm" c="var(--color-text-muted)">
        Prefer{' '}
        <Text span ff="monospace" size="sm">
          @tabler/icons-react
        </Text>
        . Only add an icon to{' '}
        <Text span ff="monospace" size="sm">
          SVGIcons.tsx
        </Text>{' '}
        when Tabler has no match. Custom outline icons should follow the Tabler
        24x24 grid and{' '}
        <Text span ff="monospace" size="sm">
          currentColor
        </Text>{' '}
        stroke so they work in light and dark.
      </Text>
    </div>

    <Group align="stretch">
      <AssetCard
        title="IconAiNotebook"
        description="AI notebooks. Tabler-compatible outline icon."
        filename="icon-ai-notebook.svg"
      >
        <IconAiNotebook size={32} />
      </AssetCard>
      <AssetCard
        title="IncidentIOIcon"
        description="incident.io brand mark. Fill, not stroke."
        filename="incident-io-icon.svg"
      >
        <IncidentIOIcon width={32} />
      </AssetCard>
    </Group>

    <div>
      <Text size="sm" fw={600} mb="sm">
        IconAiNotebook sizes
      </Text>
      <Group align="flex-end" gap="lg">
        {(
          [
            [14, 2],
            [16, 2],
            [24, 2],
            [24, 1.5],
          ] as const
        ).map(([size, stroke]) => (
          <Stack key={`${size}-${stroke}`} gap={4} align="center">
            <IconAiNotebook size={size} stroke={stroke} />
            <Text size="xs" c="var(--color-text-muted)">
              {size} / {stroke}
            </Text>
          </Stack>
        ))}
      </Group>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Using outline icons
      </Text>
      <Text size="sm" c="var(--color-text-muted)" mb="sm">
        IconAiNotebook accepts the same{' '}
        <Text span ff="monospace" size="sm">
          size
        </Text>
        ,{' '}
        <Text span ff="monospace" size="sm">
          stroke
        </Text>
        , and{' '}
        <Text span ff="monospace" size="sm">
          color
        </Text>{' '}
        props as Tabler icons. Use it on Button and ActionIcon like any other
        outline icon.
      </Text>
      <Group mb="sm">
        <Button variant="primary" leftSection={<IconAiNotebook size={16} />}>
          AI notebooks
        </Button>
        <Button variant="secondary" leftSection={<IconAiNotebook size={16} />}>
          AI notebooks
        </Button>
        <ActionIcon variant="subtle" aria-label="AI notebooks">
          <IconAiNotebook size={16} />
        </ActionIcon>
      </Group>
      <Paper
        p="md"
        withBorder
        radius="md"
        bg="var(--color-bg-code)"
        style={{ overflow: 'auto' }}
      >
        <Text
          component="pre"
          size="xs"
          ff="monospace"
          style={{ margin: 0, whiteSpace: 'pre' }}
        >
          {TABLER_USAGE}
        </Text>
      </Paper>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Using brand marks
      </Text>
      <Text size="sm" c="var(--color-text-muted)" mb="sm">
        IncidentIOIcon is a filled brand logo. It uses{' '}
        <Text span ff="monospace" size="sm">
          width
        </Text>{' '}
        (not Tabler{' '}
        <Text span ff="monospace" size="sm">
          size
        </Text>
        /
        <Text span ff="monospace" size="sm">
          stroke
        </Text>
        ) and{' '}
        <Text span ff="monospace" size="sm">
          fill=&quot;currentColor&quot;
        </Text>
        .
      </Text>
      <Paper
        p="md"
        withBorder
        radius="md"
        bg="var(--color-bg-code)"
        style={{ overflow: 'auto' }}
      >
        <Text
          component="pre"
          size="xs"
          ff="monospace"
          style={{ margin: 0, whiteSpace: 'pre' }}
        >
          {BRAND_USAGE}
        </Text>
      </Paper>
    </div>

    <div>
      <Text size="sm" fw={600} mb="xs">
        Source kind icons
      </Text>
      <Text size="sm" c="var(--color-text-muted)" mb="sm">
        Log, trace, session, and metric icons are Tabler icons, not custom SVGs.
        Use{' '}
        <Text span ff="monospace" size="sm">
          SOURCE_KIND_ICONS
        </Text>{' '}
        from{' '}
        <Text span ff="monospace" size="sm">
          sourceSelectUtils.tsx
        </Text>{' '}
        instead of picking a different Tabler icon.
      </Text>
      <Table withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Kind</Table.Th>
            <Table.Th>Icon</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {Object.entries(SOURCE_KIND_ICONS).map(([kind, icon]) => (
            <Table.Tr key={kind}>
              <Table.Td>
                <Text span ff="monospace" size="sm">
                  {kind}
                </Text>
              </Table.Td>
              <Table.Td>{icon}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  </Stack>
);
