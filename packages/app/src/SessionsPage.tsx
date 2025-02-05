import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { sub } from 'date-fns';
import {
  parseAsString,
  parseAsStringEnum,
  useQueryState,
  useQueryStates,
} from 'nuqs';
import { useForm } from 'react-hook-form';
import { NumberParam } from 'serialize-query-params';
import {
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Tabs,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useVirtualizer } from '@tanstack/react-virtual';

import { SourceSelectControlled } from '@/components/SourceSelect';
import { TimePicker } from '@/components/TimePicker';
import { getMetadata } from '@/metadata';
import { parseTimeQuery, useNewTimeQuery } from '@/timeQuery';

import { SQLInlineEditorControlled } from './components/SQLInlineEditor';
import WhereLanguageControlled from './components/WhereLanguageControlled';
import api from './api';
import { useSessions } from './clickhouse';
import { withAppNav } from './layout';
import SearchInput from './SearchInput';
import SearchInputV2 from './SearchInputV2';
import { useSource, useSources } from './source';
import { FormatTime } from './useFormatTime';
import { formatDistanceToNowStrictShort } from './utils';

function SessionCard({
  email,
  maxTime,
  minTime,
  numErrors,
  numEvents,
  onClick,
  sessionId,
  teamId,
  teamName,
  userName,
}: {
  email: string;
  maxTime: Date;
  minTime: Date;
  numErrors: number;
  numEvents: number;
  onClick: () => void;
  sessionId: string;
  teamId: string;
  teamName: string;
  userName: string;
}) {
  const timeAgo = formatDistanceToNowStrictShort(maxTime);
  const durationStr = new Date(maxTime.getTime() - minTime.getTime())
    .toISOString()
    .slice(11, 19);

  return (
    <div
      className="bg-hdx-dark rounded p-3 d-flex align-items-center justify-content-between text-white-hover-success-trigger"
      onClick={onClick}
      role="button"
    >
      <div
        style={{ width: '50%', maxWidth: 500 }}
        className="child-hover-trigger"
      >
        {email || `Anonymous Session ${sessionId}`}
      </div>
      <div>
        <div className="text-muted fs-8">{numEvents} Events</div>
        {numErrors > 0 && (
          <div className="text-danger fs-8">{numErrors} Errors</div>
        )}
        <div className="text-muted fs-8">Duration {durationStr}</div>
      </div>
      <div className="text-end">
        <div>Last active {timeAgo} ago</div>
        <div className="text-muted fs-8 mt-1">
          Started on <FormatTime value={minTime} />
        </div>
      </div>
    </div>
  );
}

function SessionCardList({
  config: { dateRange, sessionSource, traceSource, where, whereLanguage },
  onClick,
}: {
  config: {
    where?: SearchCondition;
    whereLanguage: SearchConditionLanguage;
    dateRange: DateRange['dateRange'];
    sessionSource: TSource;
    traceSource: TSource;
  };
  onClick: (sessionId: string, dateRange: [Date, Date]) => void;
}) {
  const { data: tableData, isLoading: isTableDataLoading } = useSessions({
    dateRange,
    sessionSource,
    traceSource,
    where,
    whereLanguage,
  });

  const sessions = tableData?.data ?? [];

  const parentRef = useRef<HTMLDivElement>(null);

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 86,
    paddingEnd: 16,
  });

  return (
    <>
      {isTableDataLoading === true && (
        <div className="text-center mt-8">
          <div
            className="spinner-border me-2"
            role="status"
            style={{ width: 14, height: 14 }}
          />
          Searching sessions...
        </div>
      )}
      {!isTableDataLoading && sessions.length === 0 && (
        <div className="text-center align-items-center justify-content-center my-3">
          No results found.
          <div className="text-muted mt-3">
            Try checking the query explainer in the search bar if there are any
            search syntax issues.
          </div>
          <div className="text-muted mt-3">
            Add new data sources by setting up a HyperDX integration.
          </div>
          <Button
            variant="outline-success"
            className="fs-7 mt-3"
            target="_blank"
            href="/docs/install/browser"
          >
            Install HyperDX Browser Integration
          </Button>
        </div>
      )}
      <div
        ref={parentRef}
        style={{
          height: `100%`,
          overflow: 'auto', // Make it scroll!
        }}
      >
        {/* The large inner element to hold all of the items */}
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {/* Only the visible items in the virtualizer, manually positioned to be in view */}
          {rowVirtualizer.getVirtualItems().map(virtualItem => {
            const row = sessions[virtualItem.index];

            const {
              errorCount,
              maxTimestamp,
              minTimestamp,
              sessionCount,
              sessionId,
              teamId,
              teamName,
              userEmail,
              userName,
            } = row;
            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                data-index={virtualItem.index}
                ref={rowVirtualizer.measureElement}
              >
                <div className="mb-3">
                  <SessionCard
                    sessionId={sessionId}
                    email={userEmail}
                    userName={userName}
                    teamName={teamName}
                    teamId={teamId}
                    numEvents={Number(sessionCount)}
                    numErrors={Number(errorCount)}
                    maxTime={new Date(maxTimestamp)}
                    minTime={new Date(minTimestamp)}
                    onClick={() => {
                      onClick(sessionId, [
                        sub(new Date(minTimestamp), { hours: 4 }),
                        sub(new Date(maxTimestamp), { hours: -4 }),
                      ]);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// TODO: This is a hack to set the default time range
const defaultTimeRange = parseTimeQuery('Past 1h', false) as [Date, Date];
const appliedConfigMap = {
  source: parseAsString,
  where: parseAsString,
  whereLanguage: parseAsStringEnum<'sql' | 'lucene'>(['sql', 'lucene']),
};
export default function SessionsPage() {
  const [selectedSessionQuery, setSelectedSessionQuery] = useQueryParams(
    {
      sid: withDefault(StringParam, undefined),
      sfrom: withDefault(NumberParam, undefined),
      sto: withDefault(NumberParam, undefined),
    },
    {
      updateType: 'pushIn',
      enableBatching: true,
    },
  );

  const [appliedConfig, setAppliedConfig] = useQueryStates(appliedConfigMap);

  const { data: sources } = useSources();

  const { control, watch, setValue, handleSubmit } = useForm({
    values: {
      where: appliedConfig.where,
      whereLanguage: appliedConfig.whereLanguage,
      source: appliedConfig.source,
    },
  });

  const where = watch('where');
  const whereLanguage = watch('whereLanguage');
  const sourceId = watch('source');
  const { data: sessionSource } = useSource({
    id: watch('source'),
  });

  const { data: traceTrace } = useSource({
    id: sessionSource?.traceSourceId,
  });

  useEffect(() => {
    if (sourceId && !appliedConfig.source) {
      setAppliedConfig({ source: sourceId });
    }
  }, [appliedConfig.source, setAppliedConfig, sourceId]);

  const DEFAULT_INTERVAL = 'Past 1h';
  const [displayedTimeInputValue, setDisplayedTimeInputValue] =
    useState(DEFAULT_INTERVAL);

  const { searchedTimeRange, onSearch } = useNewTimeQuery({
    initialDisplayValue: DEFAULT_INTERVAL,
    initialTimeRange: defaultTimeRange,
    setDisplayedTimeInputValue,
  });

  const onSubmit = useCallback(() => {
    onSearch(displayedTimeInputValue);
    handleSubmit(values => {
      setAppliedConfig(values);
    })();
  }, [handleSubmit, setAppliedConfig, onSearch, displayedTimeInputValue]);

  // Auto submit when service or source changes
  useEffect(() => {
    if (sourceId !== appliedConfig.source) {
      onSubmit();
    }
  }, [sourceId]);

  return (
    <div className="SessionsPage">
      <Head>
        <title>Client Sessions - HyperDX</title>
      </Head>
      <Box p="sm">
        <form
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
            return false;
          }}
        >
          <Group gap="xs">
            <Group justify="space-between" gap="xs" wrap="nowrap" flex={1}>
              <SourceSelectControlled control={control} name="source" />
              <WhereLanguageControlled
                name="whereLanguage"
                control={control}
                sqlInput={
                  <SQLInlineEditorControlled
                    connectionId={sessionSource?.connection}
                    database={sessionSource?.from?.databaseName}
                    table={sessionSource?.from?.tableName}
                    onSubmit={onSubmit}
                    control={control}
                    name="where"
                    placeholder="SQL WHERE clause (ex. column = 'foo')"
                    onLanguageChange={lang =>
                      setValue('whereLanguage', lang, {
                        shouldDirty: true,
                      })
                    }
                    language="sql"
                    label="WHERE"
                    enableHotkey
                  />
                }
                luceneInput={
                  <SearchInputV2
                    connectionId={sessionSource?.connection}
                    database={sessionSource?.from?.databaseName}
                    table={sessionSource?.from?.tableName}
                    control={control}
                    name="where"
                    onLanguageChange={lang =>
                      setValue('whereLanguage', lang, {
                        shouldDirty: true,
                      })
                    }
                    language="lucene"
                    placeholder="Search your events w/ Lucene ex. column:foo"
                    enableHotkey
                  />
                }
              />
              <TimePicker
                inputValue={displayedTimeInputValue}
                setInputValue={setDisplayedTimeInputValue}
                onSearch={range => {
                  onSearch(range);
                }}
              />
              <Button variant="outline" type="submit" px="sm">
                <i className="bi bi-play"></i>
              </Button>
            </Group>
          </Group>
        </form>
        {sessionSource?.kind !== SourceKind.Session || traceTrace == null ? (
          <Group align="center" justify="center" h="300px">
            <Text c="gray">Please select a valid session source</Text>
          </Group>
        ) : (
          <div style={{ minHeight: 0 }} className="mt-4">
            <SessionCardList
              onClick={(sessionId, dateRange) => {
                // setSelectedSession({ id: sessionId, dateRange });
              }}
              config={{
                dateRange: searchedTimeRange,
                sessionSource: sessionSource,
                traceSource: traceTrace,
                where: where as SearchCondition,
                whereLanguage: whereLanguage as SearchConditionLanguage,
              }}
            />
          </div>
        )}
      </Box>
    </div>
  );
}

SessionsPage.getLayout = withAppNav;
