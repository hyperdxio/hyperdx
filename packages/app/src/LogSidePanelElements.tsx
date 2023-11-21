import * as React from 'react';
import { format } from 'date-fns';
import { JSONTree } from 'react-json-tree';
import type { StacktraceFrame, StacktraceBreadcrumb } from './types';
import styles from '../styles/LogSidePanel.module.scss';
import { CloseButton } from 'react-bootstrap';
import { useLocalStorage } from './utils';
import { ColumnDef, Row } from '@tanstack/react-table';
import { TableCellButton } from './components/Table';
import LogLevel from './LogLevel';

import { UNDEFINED_WIDTH } from './tableUtils';

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
        className={`d-flex align-items-center mb-1 text-white-hover`}
        role="button"
        onClick={() => setCollapsed(!collapsed)}
      >
        <i className={`bi bi-chevron-${collapsed ? 'right' : 'down'} me-2`}></i>
        <div className="fs-7 text-slate-200">{title}</div>
      </div>
      {collapsed ? null : <div className="mb-4">{children}</div>}
    </div>
  );
};

export const SectionWrapper: React.FC<{ title?: React.ReactNode }> = ({
  children,
  title,
}) => (
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
      <div className="text-slate-400">{label}</div>
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
      label={isOpen ? 'Hide context' : 'Show context'}
      biIcon={isOpen ? 'chevron-up' : 'chevron-down'}
      onClick={onClick}
    />
  );
};

export const StacktraceRow = ({ row }: { row: Row<StacktraceFrame> }) => {
  const [lineContextOpen, setLineContextOpen] = React.useState(true);

  const frame = row.original;
  const hasContext = !!frame.context_line;

  const handleToggleContext = React.useCallback(() => {
    setLineContextOpen(!lineContextOpen);
  }, [lineContextOpen]);

  return (
    <>
      <div className="w-100 d-flex justify-content-between align-items-center">
        <div>
          {frame.filename}
          <span className="text-slate-400">{' in '}</span>
          {frame.function}
          {frame.lineno || frame.colno ? (
            <>
              <span className="text-slate-400">{' at line '}</span>
              <span className="text-slate-300">
                {frame.lineno}:{frame.colno}
              </span>
            </>
          ) : null}
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
          {frame.pre_context?.map((line, i) => (
            <div key={line}>
              <span className={styles.lineContextLineNo}>
                {(frame.lineno ?? 0) - (frame.pre_context?.length ?? 0) + i}
              </span>
              {line}
            </div>
          ))}
          {frame.context_line && (
            <div className={styles.lineContextCurrentLine}>
              <span className={styles.lineContextLineNo}>{frame.lineno}</span>
              {frame.context_line}
            </div>
          )}
          {frame.post_context?.map((line, i) => (
            <div key={line}>
              <span className={styles.lineContextLineNo}>
                {frame.lineno + i + 1}
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

const MAX_URL_LENGTH = 120;
const Url = ({ url }: { url?: string }) => (
  <span className="text-slate-300" title={url}>
    {url == null
      ? ''
      : url.length > MAX_URL_LENGTH
      ? `${url.slice(0, MAX_URL_LENGTH)}...`
      : url}
  </span>
);

export const breadcrumbColumns: ColumnDef<StacktraceBreadcrumb>[] = [
  {
    accessorKey: 'category',
    header: 'Category',
    size: 180,
    cell: ({ row }) => (
      <span className="text-slate-300">{row.original.category}</span>
    ),
  },
  {
    accessorKey: 'message',
    header: 'Data',
    size: UNDEFINED_WIDTH,
    cell: ({ row }) => {
      // fetch
      if (row.original.category === 'fetch' && row.original.data) {
        const { method, url } = row.original.data;
        return (
          <>
            <span>{method} </span>
            <span className="text-slate-300" title={url}>
              <Url url={url} />
            </span>
          </>
        );
      }

      // navigation
      if (row.original.category === 'navigation' && row.original.data) {
        const { from, to } = row.original.data;
        return (
          <>
            <span className="text-slate-300" title={from}>
              <Url url={from} />
            </span>
            <span>{' → '}</span>
            <span className="text-slate-300" title={to}>
              <Url url={to} />
            </span>
          </>
        );
      }

      return (
        row.original.message || <span className="text-slate-500">Empty</span>
      );
    },
  },
  {
    accessorKey: 'level',
    header: '',
    size: 80,
    cell: ({ row }) => {
      if (row.original.category === 'fetch' && row.original.data) {
        const { status_code } = row.original.data;
        return parseInt(status_code) >= 400 ? (
          <span className="text-danger"> {status_code}</span>
        ) : (
          <span className="text-slate-500"> {status_code}</span>
        );
      }
      return row.original.level ? (
        <LogLevel level={row.original.level} />
      ) : null;
    },
  },
  {
    header: 'Timestamp',
    size: 220,
    cell: ({ row }) => (
      <span className="text-slate-500">
        {format(new Date(row.original.timestamp * 1000), 'MMM d HH:mm:ss.SSS')}
      </span>
    ),
  },
];

/**
 * Request / Response Headers elements
 */
export const headerColumns: ColumnDef<[string, string]>[] = [
  {
    accessorKey: '0',
    header: 'Header',
    size: 260,
    cell: ({ row }) => (
      <div className="text-slate-300 text-truncate" title={row.original[0]}>
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
    cell: ({ row }) => (
      <span className="text-slate-300">{row.original.label}</span>
    ),
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
  const valueRenderer = React.useCallback(raw => {
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
          {typeof body === 'string' ? (
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
        <div className="text-slate-400 px-4 py-3">{emptyMessage}</div>
      ) : (
        <div className="text-slate-400 px-4 py-3">{notCollectedMessage}</div>
      )}
    </>
  );
};

/**
 * Keyboard shortcuts
 */
const Kbd = ({ children }: { children: string }) => (
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
            <Kbd>→</Kbd> arrow keys to move through events
          </div>
          <div className={styles.kbdDivider} />
          <div>
            <Kbd>ESC</Kbd> to close
          </div>
        </div>
        <CloseButton
          variant="white"
          aria-label="Hide"
          onClick={handleDismiss}
        />
      </div>
    </div>
  );
};
