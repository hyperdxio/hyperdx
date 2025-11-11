import React, { useMemo } from 'react';
import cx from 'classnames';
import { ErrorBoundary } from 'react-error-boundary';
import { Button, Text, Tooltip } from '@mantine/core';
import { Group, Loader } from '@mantine/core';
import { ColumnDef, Row, Table as TanstackTable } from '@tanstack/react-table';

import { StacktraceFrame as TStacktraceFrame } from '@/types';
import { FormatTime } from '@/useFormatTime';
import { useSourceMappedFrame } from '@/useSourceMappedFrame';

import { Table, TableCellButton } from './Table';

import styles from '../../styles/LogSidePanel.module.scss';

// https://github.com/TanStack/table/discussions/3192#discussioncomment-3873093
export const UNDEFINED_WIDTH = 99999;

export const parseEvents = (__events?: string) => {
  try {
    return JSON.parse(__events || '[]')[0].fields.reduce(
      (acc: any, field: any) => {
        try {
          acc[field.key] = JSON.parse(field.value);
        } catch (e) {
          acc[field.key] = field.value;
        }
        return acc;
      },
      {},
    );
  } catch (e) {
    return null;
  }
};

export const getFirstFrame = (frames?: TStacktraceFrame[]) => {
  if (!frames || !frames.length) {
    return null;
  }

  return (
    frames.find(frame => frame.in_app) ??
    frames.find(frame => !!frame.function || !!frame.filename) ??
    frames[0]
  );
};

export const StacktraceFrame = ({
  filename,
  function: functionName,
  lineno,
  colno,
  isLoading,
}: {
  filename: string;
  function?: string;
  lineno: number;
  colno: number;
  isLoading?: boolean;
}) => {
  return (
    <Group gap="xs" display="inline-flex">
      <div
        className=" fs-8"
        style={{
          opacity: isLoading ? 0.8 : 1,
          filter: isLoading ? 'blur(1px)' : 'none',
        }}
      >
        {filename}
        <span>
          :{lineno}:{colno}
        </span>
        <span>{' in '}</span>
        {functionName && (
          <span
            style={{
              background: '#ffffff10',
              padding: '0 4px',
              borderRadius: 4,
            }}
          >
            {functionName}
          </span>
        )}
      </div>
      {isLoading && <Loader size="xs" color="gray" />}
    </Group>
  );
};

export type StacktraceBreadcrumbCategory =
  | 'ui.click'
  | 'fetch'
  | 'xhr'
  | 'console'
  | 'navigation'
  | string;

export type StacktraceBreadcrumb = {
  type?: string;
  level?: string;
  event_id?: string;
  category?: StacktraceBreadcrumbCategory;
  message?: string;
  data?: { [key: string]: any };
  timestamp: number;
};

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
  row: Row<TStacktraceFrame>;
  table: TanstackTable<TStacktraceFrame>;
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
            <StacktraceFrame
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

export const stacktraceColumns: ColumnDef<TStacktraceFrame>[] = [
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

export type ExceptionValues = {
  type: string;
  value: string;
  mechanism?: {
    type: string;
    handled: boolean;
    data?: {
      // TODO: Are these fields dynamic?
      function?: string;
      handler?: string;
      target?: string;
    };
  };
  stacktrace?: {
    frames: TStacktraceFrame[];
  };
}[];

export const ExceptionSubpanel = ({
  logData,
  breadcrumbs,
  exceptionValues,
}: {
  logData?: any;
  breadcrumbs?: StacktraceBreadcrumb[];
  exceptionValues: ExceptionValues;
}) => {
  const firstException = exceptionValues[0];

  const shouldShowSourceMapFtux = useMemo(() => {
    return firstException?.stacktrace?.frames?.some(
      f =>
        f.filename.startsWith('http://') || f.filename.startsWith('https://'),
    );
  }, [firstException?.stacktrace?.frames]);

  const stacktraceFrames = useMemo(() => {
    if (!firstException?.stacktrace?.frames) {
      return [];
    }
    return firstException?.stacktrace.frames.slice().reverse();
  }, [firstException]);

  const firstFrameIndex = useMemo(() => {
    const firstFrame = getFirstFrame(stacktraceFrames);
    return firstFrame ? stacktraceFrames.indexOf(firstFrame) : -1;
  }, [stacktraceFrames]);

  const chronologicalBreadcrumbs = useMemo<StacktraceBreadcrumb[]>(() => {
    return [
      ...(firstException && breadcrumbs
        ? [
            {
              category: 'exception',
              timestamp: new Date(logData?.timestamp ?? 0).getTime() / 1000,
              message: `${firstException.type}: ${firstException.value} `,
            },
          ]
        : []),
      ...(breadcrumbs?.slice().reverse() ?? []),
    ];
  }, [breadcrumbs, firstException, logData?.timestamp]);

  const {
    handleToggleMoreRows: handleStacktraceToggleMoreRows,
    hiddenRowsCount: stacktraceHiddenRowsCount,
    visibleRows: stacktraceVisibleRows,
    isExpanded: stacktraceExpanded,
  } = useShowMoreRows({
    rows: stacktraceFrames,
    maxRows: Math.max(5, firstFrameIndex + 1),
  });

  const {
    handleToggleMoreRows: handleBreadcrumbToggleMoreRows,
    hiddenRowsCount: breadcrumbHiddenRowsCount,
    visibleRows: breadcrumbVisibleRows,
    isExpanded: breadcrumbExpanded,
  } = useShowMoreRows({
    rows: chronologicalBreadcrumbs,
  });

  // TODO: show all frames (stackable)
  return (
    <div>
      <SectionWrapper
        title={
          firstException && (
            <>
              <div>
                <Text fw="bold" component="span" size="sm" variant="danger">
                  {firstException.type}:{' '}
                </Text>
                <span className="text-muted">{firstException.value}</span>
              </div>

              {firstException.mechanism && (
                <div className="d-flex gap-2 flex-wrap pt-3">
                  <StacktraceValue
                    label="mechanism"
                    value={firstException.mechanism?.type}
                  />
                  <StacktraceValue
                    label="handled"
                    value={
                      firstException.mechanism?.handled ? (
                        <span className="text-success">true</span>
                      ) : (
                        <span className="text-danger">false</span>
                      )
                    }
                  />

                  {firstException.mechanism?.data?.function ? (
                    <StacktraceValue
                      label="function"
                      value={firstException.mechanism.data.function}
                    />
                  ) : null}
                  {firstException.mechanism?.data?.handler ? (
                    <StacktraceValue
                      label="handler"
                      value={firstException.mechanism.data.handler}
                    />
                  ) : null}
                  {firstException.mechanism?.data?.target ? (
                    <StacktraceValue
                      label="target"
                      value={firstException.mechanism.data.target}
                    />
                  ) : null}
                </div>
              )}
              {/* {shouldShowSourceMapFtux && <SourceMapsFtux />} */}
            </>
          )
        }
      >
        <ErrorBoundary
          onError={err => {
            console.error(err);
          }}
          fallbackRender={() => (
            <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent p-4">
              An error occurred while rendering stacktrace
            </div>
          )}
        >
          <Table
            hideHeader
            columns={stacktraceColumns}
            data={stacktraceVisibleRows}
            density="zero"
            tableMeta={{ firstFrameIndex }}
          />
        </ErrorBoundary>

        {typeof exceptionValues[0].stacktrace === 'string' && (
          <pre
            className="px-4"
            style={{
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          >
            {exceptionValues[0].stacktrace}
          </pre>
        )}

        {stacktraceHiddenRowsCount ? (
          <Button
            variant="outline"
            color="gray.6"
            size="xs"
            m="xs"
            onClick={handleStacktraceToggleMoreRows}
          >
            {stacktraceExpanded ? (
              <>
                <i className="bi bi-chevron-up me-2" /> Hide stack trace
              </>
            ) : (
              <>
                <i className="bi bi-chevron-down me-2" />
                Show {stacktraceHiddenRowsCount} more frames
              </>
            )}
          </Button>
        ) : null}
      </SectionWrapper>

      {breadcrumbVisibleRows.length > 0 && (
        <CollapsibleSection title="Breadcrumbs">
          <SectionWrapper>
            <Table
              columns={breadcrumbColumns}
              data={breadcrumbVisibleRows}
              emptyMessage="No breadcrumbs found"
            />
            {breadcrumbHiddenRowsCount ? (
              <Button
                variant="outline"
                color="gray.6"
                size="xs"
                m="xs"
                onClick={handleBreadcrumbToggleMoreRows}
              >
                {breadcrumbExpanded ? (
                  <>
                    <i className="bi bi-chevron-up me-2" /> Hide breadcrumbs
                  </>
                ) : (
                  <>
                    <i className="bi bi-chevron-down me-2" />
                    Show {breadcrumbHiddenRowsCount} more breadcrumbs
                  </>
                )}
              </Button>
            ) : null}
          </SectionWrapper>
        </CollapsibleSection>
      )}
    </div>
  );
};
