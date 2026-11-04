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

import { getBreadcrumbMaxLabelLength } from './sidePanelBreadcrumbLimits';

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
  onBack: () => void;
}) {
  const breadcrumbElements = useMemo(() => {
    return items.map((item, i) => {
      const isLast = i === items.length - 1;
      const maxLen = getBreadcrumbMaxLabelLength(i, items.length);
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
        <Tooltip
          label={<span style={{ overflowWrap: 'anywhere' }}>{item.label}</span>}
          position="bottom"
          multiline
          maw={400}
        >
          {content}
        </Tooltip>
      ) : (
        content
      );

      if (isLast || !item.onClick) {
        return (
          <Text
            key={i}
            data-testid={`side-panel-breadcrumb-${i}`}
            size="xs"
            c={isLast ? undefined : 'dimmed'}
            component="span"
          >
            {wrapped}
          </Text>
        );
      }

      return (
        <UnstyledButton
          key={i}
          data-testid={`side-panel-breadcrumb-${i}`}
          onClick={item.onClick}
        >
          <Text size="xs" c="dimmed" component="span">
            {wrapped}
          </Text>
        </UnstyledButton>
      );
    });
  }, [items]);

  return (
    <Group
      data-testid="side-panel-breadcrumbs"
      gap={8}
      wrap="nowrap"
      style={{ minWidth: 0, flex: 1 }}
    >
      <Tooltip label="Back" position="bottom">
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onBack}
          aria-label="Back"
        >
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
