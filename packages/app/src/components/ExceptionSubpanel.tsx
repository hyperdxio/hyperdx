/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo } from 'react';
import cx from 'classnames';
import { ErrorBoundary } from 'react-error-boundary';
import { Badge } from '@clickhouse/click-ui';
import { Button, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Group, Loader } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconLogs,
} from '@tabler/icons-react';
import { ColumnDef, Row, Table as TanstackTable } from '@tanstack/react-table';

import { CopySnippet } from '@/components/ClickStackOnboarding/CopySnippet';
import type {
  StacktraceBreadcrumb,
  StacktraceFrame as TStacktraceFrame,
} from '@/types';
import { FormatTime } from '@/useFormatTime';
import { useSourceMappedFrame } from '@/useSourceMappedFrame';
import { UNKNOWN_FUNCTION } from '@/utils/sentryStackParser';

import { Table, TableCellButton } from './Table';

import styles from '@styles/LogSidePanel.module.scss';

// https://github.com/TanStack/table/discussions/3192#discussioncomment-3873093
const UNDEFINED_WIDTH = 99999;

const parseEvents = (__events?: string) => {
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

const getFirstFrame = (frames?: TStacktraceFrame[]) => {
  if (!frames || !frames.length) {
    return null;
  }

  return (
    frames.find(frame => frame.in_app) ??
    frames.find(frame => !!frame.function || !!frame.filename) ??
    frames[0]
  );
};

const StacktraceFrame = ({
  filename,
  function: functionName,
  lineno,
  colno,
  isLoading,
}: {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
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
        {lineno != null && (
          <span>
            :{lineno}
            {colno != null && `:${colno}`}
          </span>
        )}
        {functionName && functionName !== UNKNOWN_FUNCTION && (
          <>
            <span>{' in '}</span>
            <span
              style={{
                background: '#ffffff10',
                padding: '0 4px',
                borderRadius: 4,
              }}
            >
              {functionName}
            </span>
          </>
        )}
      </div>
      {isLoading && <Loader size="xs" color="gray" />}
    </Group>
  );
};

const CollapsibleSection = ({
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
 * Stacktrace elements
 */
const StacktraceValue = ({
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

const NOT_IN_APP_LABEL = 'Library or framework code';

const StacktraceRow = ({
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

  const { isLoading, enrichedFrame } = useSourceMappedFrame();

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
              label={NOT_IN_APP_LABEL}
              position="top-start"
              withArrow
              color="gray"
            >
              <IconLogs
                size={14}
                className="me-2"
                aria-label={NOT_IN_APP_LABEL}
              />
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
                {(augmentedFrame.lineno ?? 0) + i + 1}
              </span>
              {line}
            </div>
          ))}
        </pre>
      )}
    </>
  );
};

const stacktraceColumns: ColumnDef<TStacktraceFrame>[] = [
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
  const state =
    status >= 500 ? 'danger' : status >= 400 ? 'warning' : 'success';
  return <Badge size="sm" text={status} state={state} />;
});

const LevelChip = React.memo(({ level }: { level?: string }) => {
  if (!level) {
    return null;
  }
  const state = level.includes('error')
    ? 'danger'
    : level.includes('warn')
      ? 'warning'
      : 'neutral';
  return <Badge size="sm" text={level} state={state} />;
});

const breadcrumbColumns: ColumnDef<StacktraceBreadcrumb>[] = [
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

type ExceptionValue = {
  type: string;
  value?: string;
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
  /** A string when the stack text could not be parsed into frames. */
  stacktrace?: { frames: TStacktraceFrame[] } | string;
  /** The unparsed stack text, set when `stacktrace` was parsed from it. */
  rawStacktrace?: string;
};

const getFrames = ({ stacktrace }: ExceptionValue) =>
  typeof stacktrace === 'string' ? undefined : stacktrace?.frames;

const getExceptionTitle = ({ type, value }: ExceptionValue) =>
  [type, value?.trim()].filter(Boolean).join(': ');

const ExceptionTitle = ({
  exception,
  isCause,
  singleLine,
}: {
  exception: ExceptionValue;
  isCause: boolean;
  singleLine: boolean;
}) => {
  const message = exception.value?.trim() ?? '';

  return (
    <Text
      component="span"
      inherit
      truncate={singleLine}
      title={singleLine ? getExceptionTitle(exception) : undefined}
      style={
        singleLine
          ? undefined
          : { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
      }
    >
      {isCause && <span className="text-muted">Caused by: </span>}
      {exception.type && (
        <Text fw="bold" component="span" size="sm" variant="danger">
          {exception.type}
        </Text>
      )}
      <span className="text-muted">
        {exception.type && message && ': '}
        {singleLine ? message.replace(/\s+/g, ' ') : message}
      </span>
    </Text>
  );
};

const ExceptionStacktrace = ({ exception }: { exception: ExceptionValue }) => {
  const stacktraceFrames = useMemo(
    () => getFrames(exception)?.slice().reverse() ?? [],
    [exception],
  );

  const firstFrameIndex = useMemo(() => {
    const firstFrame = getFirstFrame(stacktraceFrames);
    return firstFrame ? stacktraceFrames.indexOf(firstFrame) : -1;
  }, [stacktraceFrames]);

  const {
    handleToggleMoreRows: handleStacktraceToggleMoreRows,
    hiddenRowsCount: stacktraceHiddenRowsCount,
    visibleRows: stacktraceVisibleRows,
    isExpanded: stacktraceExpanded,
  } = useShowMoreRows({
    rows: stacktraceFrames,
    maxRows: Math.max(5, firstFrameIndex + 1),
  });

  return (
    <>
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

      {stacktraceHiddenRowsCount ? (
        <Button
          variant="secondary"
          size="xs"
          m="xs"
          onClick={handleStacktraceToggleMoreRows}
        >
          {stacktraceExpanded ? (
            <>
              <IconChevronUp size={14} className="me-2" /> Hide stack trace
            </>
          ) : (
            <>
              <IconChevronDown size={14} className="me-2" />
              Show {stacktraceHiddenRowsCount} more frames
            </>
          )}
        </Button>
      ) : null}
    </>
  );
};

const ExceptionValueSection = ({
  exception,
  isCause,
}: {
  exception: ExceptionValue;
  isCause: boolean;
}) => {
  const hasFrames = !!getFrames(exception)?.length;

  const unparsedStack =
    !isCause && typeof exception.stacktrace === 'string'
      ? exception.stacktrace
      : '';

  const collapsible = isCause && hasFrames;
  const [expanded, setExpanded] = React.useState(!isCause);
  const open = expanded || !collapsible;
  const Chevron = expanded ? IconChevronDown : IconChevronRight;

  return (
    <SectionWrapper
      title={
        <>
          {collapsible ? (
            <UnstyledButton
              className="d-flex align-items-start w-100"
              fz="inherit"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              <Chevron
                size={14}
                className="me-2 flex-shrink-0"
                style={{ height: '1lh' }}
              />
              <ExceptionTitle
                exception={exception}
                isCause={isCause}
                singleLine={!expanded}
              />
            </UnstyledButton>
          ) : (
            <div>
              <ExceptionTitle
                exception={exception}
                isCause={isCause}
                singleLine={false}
              />
            </div>
          )}

          {open && exception.mechanism && (
            <div className="d-flex gap-2 flex-wrap pt-3">
              <StacktraceValue
                label="mechanism"
                value={exception.mechanism?.type}
              />
              <StacktraceValue
                label="handled"
                value={
                  exception.mechanism?.handled ? (
                    <span className="text-success">true</span>
                  ) : (
                    <span className="text-danger">false</span>
                  )
                }
              />

              {exception.mechanism?.data?.function ? (
                <StacktraceValue
                  label="function"
                  value={exception.mechanism.data.function}
                />
              ) : null}
              {exception.mechanism?.data?.handler ? (
                <StacktraceValue
                  label="handler"
                  value={exception.mechanism.data.handler}
                />
              ) : null}
              {exception.mechanism?.data?.target ? (
                <StacktraceValue
                  label="target"
                  value={exception.mechanism.data.target}
                />
              ) : null}
            </div>
          )}
        </>
      }
    >
      {open && hasFrames && <ExceptionStacktrace exception={exception} />}
      {unparsedStack ? (
        <pre
          className="px-4"
          style={{
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
          }}
        >
          {unparsedStack}
        </pre>
      ) : null}
    </SectionWrapper>
  );
};

export const ExceptionSubpanel = ({
  logData,
  breadcrumbs,
  exceptionValues,
}: {
  logData?: any;
  breadcrumbs?: StacktraceBreadcrumb[];
  /** The thrown error first, then each error in its `cause` chain. */
  exceptionValues: ExceptionValue[];
}) => {
  const firstException = exceptionValues[0];

  const shouldShowSourceMapFtux = useMemo(() => {
    return (
      firstException &&
      getFrames(firstException)?.some(
        f =>
          f.filename.startsWith('http://') || f.filename.startsWith('https://'),
      )
    );
  }, [firstException]);

  const chronologicalBreadcrumbs = useMemo<StacktraceBreadcrumb[]>(() => {
    return [
      ...(firstException && breadcrumbs
        ? [
            {
              category: 'exception',
              timestamp: new Date(logData?.timestamp ?? 0).getTime() / 1000,
              message: getExceptionTitle(firstException),
            },
          ]
        : []),
      ...(breadcrumbs?.slice().reverse() ?? []),
    ];
  }, [breadcrumbs, firstException, logData?.timestamp]);

  const {
    handleToggleMoreRows: handleBreadcrumbToggleMoreRows,
    hiddenRowsCount: breadcrumbHiddenRowsCount,
    visibleRows: breadcrumbVisibleRows,
    isExpanded: breadcrumbExpanded,
  } = useShowMoreRows({
    rows: chronologicalBreadcrumbs,
  });

  return (
    <div>
      {exceptionValues.map((exception, i) => (
        <ExceptionValueSection key={i} exception={exception} isCause={i > 0} />
      ))}
      {/* {shouldShowSourceMapFtux && <SourceMapsFtux />} */}

      {firstException?.rawStacktrace && (
        <CollapsibleSection title="Raw stack trace" initiallyCollapsed>
          <SectionWrapper>
            <CopySnippet snippet={firstException.rawStacktrace} />
          </SectionWrapper>
        </CollapsibleSection>
      )}

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
                variant="secondary"
                size="xs"
                m="xs"
                onClick={handleBreadcrumbToggleMoreRows}
              >
                {breadcrumbExpanded ? (
                  <>
                    <IconChevronUp size={14} className="me-2" /> Hide
                    breadcrumbs
                  </>
                ) : (
                  <>
                    <IconChevronDown size={14} className="me-2" />
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
