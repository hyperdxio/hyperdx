import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { format } from 'date-fns';
import { JSONTree } from 'react-json-tree';
import { Alert, Button, CloseButton, Text, Tooltip } from '@mantine/core';
import { ColumnDef, Row, Table } from '@tanstack/react-table';

import HyperJson from './components/HyperJson';
import { Icon } from './components/Icon';
import { StacktraceFrame as StacktraceFrameCmp } from './components/StacktraceFrame';
import { TableCellButton } from './components/Table';
import { UNDEFINED_WIDTH } from './tableUtils';
import type { StacktraceBreadcrumb, StacktraceFrame } from './types';
import { FormatTime } from './useFormatTime';
import { useSourceMappedFrame } from './useSourceMappedFrame';
import { useLocalStorage } from './utils';

import styles from '../styles/LogSidePanel.module.scss';

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
        <i className={`bi bi-chevron-${collapsed ? 'right' : 'down'} me-2`}></i>
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
    {title && <div className={styles.panelSectionWrapperTitle}>{title}</div>}
    {children}
  </div>
);

/**
 * Stacktrace elements
 */
export const StacktraceValue = ({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) => {
  return (
    <div
      style={{
        paddingRight: 20,
        marginRight: 12,
        borderRight: '1px solid #ffffff20',
      }}
    >
      <div>{label}</div>
      <div className="fs-7">{value}</div>
    </div>
  );
};

const StacktraceRowExpandButton = ({
  onClick,
  isOpen,
}: {
  onClick: VoidFunction;
  isOpen: boolean;
}) => {
  return (
    <TableCellButton
      label=""
      biIcon={isOpen ? 'chevron-up' : 'chevron-down'}
      onClick={onClick}
    />
  );
};

export const StacktraceRow = ({
  row,
  table,
}: {
  row: Row<StacktraceFrame>;
  table: Table<StacktraceFrame>;
}) => {
  const tableMeta = table.options.meta as {
    firstFrameIndex?: number;
  };

  const [lineContextOpen, setLineContextOpen] = React.useState(
    row.index === tableMeta.firstFrameIndex,
  );

  const handleToggleContext = React.useCallback(() => {
    setLineContextOpen(!lineContextOpen);
  }, [lineContextOpen]);

  const frame = row.original;

  const { isLoading, enrichedFrame } = useSourceMappedFrame(frame);

  const augmentedFrame = enrichedFrame ?? frame;
  const hasContext = !!augmentedFrame.context_line;

  return (
    <>
      <div
        className={cx(
          'w-100 py-2 px-4 d-flex justify-content-between align-items-center',
          { [styles.stacktraceRowInteractive]: hasContext },
        )}
        onClick={handleToggleContext}
      >
        <div>
          {!augmentedFrame.in_app && (
            <Tooltip
              label="in_app: false"
              position="top"
              withArrow
              color="gray"
            >
              <i className="bi bi-box-seam me-2" title="in_app: false" />
            </Tooltip>
          )}
          {augmentedFrame && (
            <StacktraceFrameCmp
              colno={augmentedFrame.colno}
              filename={augmentedFrame.filename}
              lineno={augmentedFrame.lineno}
              function={augmentedFrame.function}
              isLoading={isLoading}
            />
          )}
        </div>
        {hasContext && (
          <StacktraceRowExpandButton
            onClick={handleToggleContext}
            isOpen={lineContextOpen}
          />
        )}
      </div>

      {lineContextOpen && hasContext && (
        <pre className={styles.lineContext}>
          {augmentedFrame.pre_context?.map((line, i) => (
            <div key={line + i}>
              <span className={styles.lineContextLineNo}>
                {(augmentedFrame.lineno ?? 0) -
                  (augmentedFrame.pre_context?.length ?? 0) +
                  i}
              </span>
              {line}
            </div>
          ))}
          {augmentedFrame.context_line && (
            <div className={styles.lineContextCurrentLine}>
              <span className={styles.lineContextLineNo}>
                {augmentedFrame.lineno}
              </span>
              {augmentedFrame.context_line}
            </div>
          )}
          {augmentedFrame.post_context?.map((line, i) => (
            <div key={line + i}>
              <span className={styles.lineContextLineNo}>
                {augmentedFrame.lineno + i + 1}
              </span>
              {line}
            </div>
          ))}
        </pre>
      )}
    </>
  );
};

export const stacktraceColumns: ColumnDef<StacktraceFrame>[] = [
  {
    accessorKey: 'filename',
    cell: StacktraceRow,
  },
];

/**
 * Breadcrumbs
 */

const Url = ({ url }: { url?: string }) => <span title={url}>{url}</span>;

const StatusChip = React.memo(({ status }: { status?: number }) => {
  if (!status) {
    return null;
  }
  const className =
    status >= 500
      ? 'text-danger bg-danger'
      : status >= 400
        ? 'text-warning bg-warning'
        : 'text-success bg-success';
  return (
    <span
      className={`badge lh-base rounded-5 bg-opacity-10 fw-normal ${className}`}
    >
      {status}
    </span>
  );
});

const LevelChip = React.memo(({ level }: { level?: string }) => {
  if (!level) {
    return null;
  }
  const className = level.includes('error')
    ? 'text-danger bg-danger'
    : level.includes('warn') || level.includes('warning')
      ? 'text-warning bg-warning'
      : 'bg-muted';

  return (
    <span
      className={`badge lh-base rounded-5 bg-opacity-10 fw-normal ${className}`}
    >
      {level}
    </span>
  );
});

export const breadcrumbColumns: ColumnDef<StacktraceBreadcrumb>[] = [
  {
    accessorKey: 'category',
    header: 'Category',
    size: 180,
    cell: ({ row }) => (
      <span className="d-flex align-items-center gap-2">
        {row.original.category}
        {row.original.category === 'console' && (
          <LevelChip level={row.original.level} />
        )}
        {row.original.category === 'fetch' ||
        row.original.category === 'xhr' ? (
          <StatusChip status={row.original.data?.status_code} />
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: 'message',
    header: 'Data',
    size: UNDEFINED_WIDTH,
    cell: ({ row }) => {
      // fetch
      if (
        row.original.data &&
        (row.original.category === 'fetch' || row.original.category === 'xhr')
      ) {
        const { method, url } = row.original.data;
        return (
          <div className="text-truncate">
            <span>{method} </span>
            <span title={url}>
              <Url url={url} />
            </span>
          </div>
        );
      }

      // navigation
      if (row.original.category === 'navigation' && row.original.data) {
        const { from, to } = row.original.data;
        return (
          <div className="text-truncate">
            <span title={from}>
              <Url url={from} />
            </span>
            <span>{' → '}</span>
            <span title={to}>
              <Url url={to} />
            </span>
          </div>
        );
      }

      // console
      if (row.original.category === 'console') {
        const { message } = row.original;
        return (
          <pre className="mb-0 text-truncate fs-8" title={message}>
            {message}
          </pre>
        );
      }

      if (row.original.message) {
        return <div className="text-truncate">{row.original.message}</div>;
      }

      return <span className="text-muted">Empty</span>;
    },
  },
  {
    header: 'Timestamp',
    size: 220,
    cell: ({ row }) => (
      <span className="text-muted">
        <FormatTime value={row.original.timestamp * 1000} format="withMs" />
      </span>
    ),
  },
];

export const useShowMoreRows = <T extends object>({
  rows,
  maxRows = 5,
}: {
  rows: T[];
  maxRows?: number;
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const visibleRows = React.useMemo(() => {
    return isExpanded ? rows : rows.slice(0, maxRows);
  }, [rows, isExpanded, maxRows]);

  const hiddenRowsCount = React.useMemo<number | null>(() => {
    const length = rows.length ?? 0;
    return length > maxRows ? length - maxRows : null;
  }, [rows.length, maxRows]);

  const handleToggleMoreRows = React.useCallback(() => {
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  return { visibleRows, hiddenRowsCount, handleToggleMoreRows, isExpanded };
};

/**
 * Request / Response Headers elements
 */
export const headerColumns: ColumnDef<[string, string]>[] = [
  {
    accessorKey: '0',
    header: 'Header',
    size: 260,
    cell: ({ row }) => (
      <div className="text-truncate" title={row.original[0]}>
        {row.original[0]}
      </div>
    ),
  },
  {
    size: UNDEFINED_WIDTH,
    accessorKey: '1',
    header: 'Value',
  },
];

/**
 * Network Subpanel
 */
export const networkColumns: ColumnDef<{
  label: string;
  value: string;
  className?: string;
}>[] = [
  {
    accessorKey: 'label',
    header: 'Label',
    size: 260,
    cell: ({ row }) => <span>{row.original.label}</span>,
  },
  {
    size: UNDEFINED_WIDTH,
    accessorKey: 'value',
    header: 'Value',
    cell: ({ row }) => (
      <span className={row.original.className}>{row.original.value}</span>
    ),
  },
];

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
    } catch (e) {
      return null;
    }
  }, [body]);

  return (
    <>
      {body != null && body != '' ? (
        <pre
          className="m-0 px-4 py-3"
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
export const Kbd = ({ children }: { children: string }) => (
  <div className={styles.kbd}>{children}</div>
);

export const LogSidePanelKbdShortcuts = () => {
  const [isDismissed, setDismissed] = useLocalStorage<boolean>(
    'kbd-shortcuts-dismissed',
    false,
  );

  const handleDismiss = React.useCallback(() => {
    setDismissed(true);
  }, [setDismissed]);

  if (isDismissed) {
    return null;
  }

  return (
    <div className={styles.kbdShortcuts}>
      <div className="d-flex justify-content-between align-items-center ">
        <div className="d-flex align-items-center gap-3">
          <div>
            Use <Kbd>←</Kbd>
            <Kbd>→</Kbd> arrow keys or <Kbd>k</Kbd>
            <Kbd>j</Kbd> to move through events
          </div>
          <div className={styles.kbdDivider} />
          <div>
            <Kbd>ESC</Kbd> to close
          </div>
        </div>
        <CloseButton aria-label="Hide" onClick={handleDismiss} />
      </div>
    </div>
  );
};

export const SourceMapsFtux = () => {
  const [isDismissed, setIsDismissed] = useLocalStorage(
    'sourceMapsFtuxDismissed',
    false,
  );

  if (isDismissed) {
    return null;
  }

  return (
    <Alert
      color="gray"
      withCloseButton
      py="xs"
      mt="xs"
      onClose={() => setIsDismissed(true)}
    >
      <Text size="xs">
        <Icon name="code-square" /> Some of the stack frames are pointing to
        minified files. Use hyperdx-cli to upload your source maps and see the
        original code.
      </Text>
      <Link href="https://www.npmjs.com/package/@hyperdx/cli" target="_blank">
        <Button size="compact-xs" variant="light" mt="xs">
          See docs
        </Button>
      </Link>
    </Alert>
  );
};
