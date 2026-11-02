import * as React from 'react';
import { JSONTree } from 'react-json-tree';
import { Group, Kbd, Modal, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { ColumnDef } from '@tanstack/react-table';

import HyperJson from './components/HyperJson';
import type { HttpHeader } from './utils/httpHeaders';
import { UNDEFINED_WIDTH } from './tableUtils';

import styles from '@styles/LogSidePanel.module.scss';

export const CollapsibleSection = ({
  title,
  children,
  initiallyCollapsed,
}: {
  title: string;
  children: React.ReactNode;
  initiallyCollapsed?: boolean;
}) => {
  const [collapsed, setCollapsed] = React.useState(initiallyCollapsed ?? false);

  return (
    <div className="my-3">
      <div
        className={`d-flex align-items-center mb-1 text-white-hover w-50`}
        role="button"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <IconChevronRight size={14} className="me-2" />
        ) : (
          <IconChevronDown size={14} className="me-2" />
        )}
        <div className="fs-7">{title}</div>
      </div>
      {collapsed ? null : <div className="mb-4">{children}</div>}
    </div>
  );
};

export const SectionWrapper: React.FC<
  React.PropsWithChildren<{ title?: React.ReactNode }>
> = ({ children, title }) => (
  <div className={styles.panelSectionWrapper}>
    {!!title && <div className={styles.panelSectionWrapperTitle}>{title}</div>}
    {children}
  </div>
);

/**
 * Request / Response Headers elements
 */
export const headerColumns: ColumnDef<HttpHeader>[] = [
  {
    accessorKey: 'name',
    header: 'Header',
    size: 260,
    cell: ({ row }) => (
      <div className="text-truncate" title={row.original.attributeKey}>
        {row.original.name}
      </div>
    ),
  },
  {
    size: UNDEFINED_WIDTH,
    accessorKey: 'value',
    header: 'Value',
  },
];

/**
 * Network Subpanel
 */
export const NetworkBody = ({
  body,
  theme,
  emptyMessage,
  notCollectedMessage,
}: {
  body: any;
  theme?: any;
  emptyMessage?: string;
  notCollectedMessage?: string;
}) => {
  const valueRenderer = React.useCallback((raw: any) => {
    return (
      <pre
        className="d-inline text-break"
        style={{
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
        }}
      >
        {raw}
      </pre>
    );
  }, []);

  const parsedBody = React.useMemo(() => {
    if (typeof body !== 'string') return null;
    try {
      if (
        (body.startsWith('{') && body.endsWith('}')) ||
        (body.startsWith('[') && body.endsWith(']'))
      ) {
        const parsed = JSON.parse(body);
        return parsed;
      }
    } catch {
      return null;
    }
  }, [body]);

  return (
    <>
      {body != null && body != '' ? (
        <pre
          className={parsedBody ? 'm-0' : 'm-0 px-4 py-3'}
          style={{
            wordBreak: 'break-all',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        >
          {parsedBody ? (
            <HyperJson data={parsedBody} normallyExpanded />
          ) : typeof body === 'string' ? (
            body
          ) : (
            <JSONTree
              hideRoot
              invertTheme={false}
              data={body}
              theme={theme}
              valueRenderer={valueRenderer}
            />
          )}
        </pre>
      ) : body === '' ? (
        <div className="px-4 py-3">{emptyMessage}</div>
      ) : (
        <div className="px-4 py-3">{notCollectedMessage}</div>
      )}
    </>
  );
};

/**
 * Keyboard shortcuts
 */
const SHORTCUTS = [
  { keys: ['esc'], label: 'Close panel' },
  { keys: ['←', '→'], label: 'Navigate between events' },
  { keys: ['↑', '↓'], label: 'Navigate between events' },
  { keys: ['k', 'j'], label: 'Navigate between events' },
  { keys: ['⌘/Ctrl', 'scroll'], label: 'Zoom trace timeline' },
] as const;

export const KeyboardShortcutsModal = ({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) => {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Keyboard Shortcuts"
      size="sm"
      centered
    >
      <Stack gap="sm">
        {SHORTCUTS.map(({ keys, label }) => (
          <Group key={label} justify="space-between">
            <Group gap={4}>
              {keys.map((key, i) => (
                <React.Fragment key={key}>
                  {i > 0 && (
                    <Text span size="xs" c="dimmed">
                      +
                    </Text>
                  )}
                  <Kbd size="xs">{key}</Kbd>
                </React.Fragment>
              ))}
            </Group>
            <Text size="sm">{label}</Text>
          </Group>
        ))}
      </Stack>
    </Modal>
  );
};
