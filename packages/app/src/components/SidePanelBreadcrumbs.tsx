import { memo, useMemo } from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import {
  ActionIcon,
  Breadcrumbs,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconConnection,
  IconDeviceLaptop,
  IconLogs,
} from '@tabler/icons-react';

const MAX_LABEL_LENGTH_SINGLE = 120;
const MAX_LABEL_LENGTH_CURRENT = 40;
const MAX_LABEL_LENGTH_PREVIOUS = 20;

export type BreadcrumbItem = {
  label: string;
  sourceKind?: SourceKind;
  onClick?: () => void;
};

function SourceIcon({ kind }: { kind?: SourceKind }) {
  if (kind === SourceKind.Trace) {
    return <IconConnection size={14} style={{ flexShrink: 0 }} />;
  }
  if (kind === SourceKind.Log) {
    return <IconLogs size={14} style={{ flexShrink: 0 }} />;
  }
  if (kind === SourceKind.Session) {
    return <IconDeviceLaptop size={14} style={{ flexShrink: 0 }} />;
  }
  return null;
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function SidePanelBreadcrumbs({
  items,
  onBack,
}: {
  items: BreadcrumbItem[];
  /** Always shown before the trail; closes the panel at root or pops navigation. */
  onBack: () => void;
}) {
  const breadcrumbElements = useMemo(() => {
    return items.map((item, i) => {
      const isLast = i === items.length - 1;
      const isSingle = items.length === 1;
      const maxLen = isSingle
        ? MAX_LABEL_LENGTH_SINGLE
        : isLast
          ? MAX_LABEL_LENGTH_CURRENT
          : MAX_LABEL_LENGTH_PREVIOUS;
      const truncatedLabel = truncate(item.label, maxLen);
      const needsTooltip = item.label.length > maxLen;

      const content = (
        <Group gap={4} wrap="nowrap">
          {i === 0 && <SourceIcon kind={item.sourceKind} />}
          <Text size="xs" fw={isLast ? 600 : undefined} truncate="end">
            {truncatedLabel}
          </Text>
        </Group>
      );

      const wrapped = needsTooltip ? (
        <Tooltip label={item.label} position="bottom" multiline maw={400}>
          {content}
        </Tooltip>
      ) : (
        content
      );

      if (isLast || !item.onClick) {
        return (
          <Text
            key={i}
            size="xs"
            c={isLast ? undefined : 'dimmed'}
            component="span"
          >
            {wrapped}
          </Text>
        );
      }

      return (
        <UnstyledButton key={i} onClick={item.onClick}>
          <Text size="xs" c="dimmed" component="span">
            {wrapped}
          </Text>
        </UnstyledButton>
      );
    });
  }, [items]);

  return (
    <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
      <Tooltip label="Back" position="bottom">
        <ActionIcon variant="link" size="sm" onClick={onBack} aria-label="Back">
          <IconArrowLeft size={14} />
        </ActionIcon>
      </Tooltip>
      {items.length > 0 ? (
        <Breadcrumbs
          separator="›"
          separatorMargin={6}
          styles={{
            root: { flexWrap: 'nowrap', overflow: 'hidden' },
            separator: { color: 'var(--mantine-color-dimmed)' },
          }}
        >
          {breadcrumbElements}
        </Breadcrumbs>
      ) : null}
    </Group>
  );
}

export default memo(SidePanelBreadcrumbs);
