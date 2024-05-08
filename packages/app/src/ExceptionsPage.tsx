import * as React from 'react';
import dynamic from 'next/dynamic';
import Head from 'next/head';
import { formatDistanceToNow } from 'date-fns';
import { useQueryState } from 'nuqs';
import { Card, Group, Select, Stack } from '@mantine/core';

import api from './api';
import { ExceptionsDetailsPane } from './ExceptionDetailsPanel';
import { withAppNav } from './layout';
import { PatternTrendChart } from './PatternTable';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { SearchInput } from './ServiceDashboardPage';
import { parseTimeQuery, useTimeQuery } from './timeQuery';

import styles from '../styles/ExceptionDetailsPanel.module.scss';

const COL_VOLUME_WIDTH = 200;
const COL_COUNT_WIDTH = 100;
const COL_USERS_WIDTH = 100;

const defaultTimeRange = parseTimeQuery('Past 1h', false);

// TODO: Remove mock data
export const mockException = {
  id: 'mock_1',
  timestamp: '2021-08-10T14:43:22.432Z',
  firstSeen: '2021-08-10T14:00:00.000Z',
  service: 'mock-service',
  type: 'SyntaxError',
  value: 'Unexpected token { in JSON at position 0',
  count: 3313,
  usersAffected: 32,
  volume: [
    // {}
  ],
  mechanism: {
    handled: false,
    type: 'middleware',
  },
  frames: [
    {
      filename: '/usr/local/app/src/index.js',
      function: '<anonymous>',
      lineno: 7,
      colno: 54,
    },
  ],
};

type ExceptionRowProps = {
  dateRange: [Date, Date];
  pattern: any;
  onClick: () => void;
};

export const ExceptionRow = React.memo(
  ({ onClick, pattern, dateRange }: ExceptionRowProps) => {
    const firstFrame = mockException.frames[0];

    return (
      <Card onClick={onClick} className={styles.exceptionRowCard} p="xs">
        <Group align="center">
          <div className={styles.exceptionRowLevel} />
          <div style={{ flex: 1 }}>
            {/* todo extract into separate component */}
            <Stack gap={4}>
              <Group>
                <strong className="text-white">{pattern.pattern}</strong>
                <div className="text-slate-200 fs-8">
                  {firstFrame.filename}
                  <span className="text-slate-400">{' in '}</span>
                  <span className={styles.exceptionFunction}>
                    {firstFrame.function}:{firstFrame.lineno}
                  </span>
                </div>
              </Group>
              <div className="text-slate-300 fs-8">{mockException.value}</div>
              <Group className="text-slate-300 fs-8" mt={6} gap={6}>
                <div>{pattern.service}</div>
                <span className="text-slate-600">&middot;</span>
                <div title={mockException.timestamp}>
                  Last seen{' '}
                  {formatDistanceToNow(new Date(mockException.timestamp), {
                    addSuffix: true,
                  })}
                </div>
                <span className="text-slate-600">&middot;</span>
                <div>
                  {formatDistanceToNow(new Date(mockException.firstSeen))} old
                </div>
              </Group>
            </Stack>
          </div>
          <div style={{ width: COL_USERS_WIDTH, textAlign: 'right' }}>
            <div className="text-white fw-semi">
              {mockException.usersAffected}
            </div>
          </div>
          <div style={{ width: COL_COUNT_WIDTH, textAlign: 'right' }}>
            <div className="text-white fw-semi">{mockException.count}</div>
          </div>
          <div
            style={{ width: COL_VOLUME_WIDTH, textAlign: 'right', height: 60 }}
          >
            <PatternTrendChart
              dateRange={dateRange}
              data={pattern?.trends?.data}
              granularity={pattern?.trends?.granularity}
            />
          </div>
        </Group>
      </Card>
    );
  },
);

const ExceptionsPage = () => {
  const [exceptionGroupId, setExceptionGroupId] =
    useQueryState('exceptionGroupId');

  const handleExceptionClick = React.useCallback(() => {
    // TODO
    setExceptionGroupId('1');
  }, [setExceptionGroupId]);

  // Fetch services
  const { data: services, isLoading: isServicesLoading } = api.useServices();
  const servicesOptions = React.useMemo(() => {
    return Object.keys(services?.data ?? {}).map(name => ({
      value: name,
      label: name,
    }));
  }, [services]);

  const [searchQuery, setSearchQuery] = useQueryState('q', {
    history: 'replace',
    defaultValue: '',
  });

  const [service, setService] = useQueryState('service', {
    history: 'replace',
    defaultValue: '',
  });

  const {
    searchedTimeRange: dateRange,
    displayedTimeInputValue,
    setDisplayedTimeInputValue,
    onSearch,
  } = useTimeQuery({
    isUTC: false,
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const where = `hyperdx_platform:"sentry"${
    service ? ` service:"${service}"` : ''
  }${searchQuery ? `(${searchQuery}) ` : ''}`;

  // TODO: Use correct API to fetch exception groups
  const { data: patterns, isFetching: isPatternsFetching } = api.useLogPatterns(
    {
      q: where,
      startDate: dateRange?.[0] ?? new Date(),
      endDate: dateRange?.[1] ?? new Date(),
      sampleRate: 1,
    },
    {
      refetchOnWindowFocus: false,
    },
  );

  return (
    <div>
      <Head>
        <title>Exceptions</title>
      </Head>

      <ExceptionsDetailsPane dateRange={dateRange} />

      <div className="d-flex flex-column">
        <Group
          px="md"
          py="xs"
          className="border-bottom border-dark"
          gap="xs"
          align="center"
        >
          {/* Use Autocomplete instead? */}
          <Select
            searchable
            clearable
            allowDeselect
            placeholder="All Services"
            maxDropdownHeight={280}
            data={servicesOptions}
            disabled={isServicesLoading}
            radius="md"
            variant="filled"
            value={service}
            onChange={v => setService(v)}
            w={300}
          />
          <div style={{ flex: 1 }}>
            <SearchInput
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              placeholder="Scope exceptions to..."
            />
          </div>
          <form
            className="d-flex"
            style={{ width: 350, height: 36 }}
            onSubmit={e => {
              e.preventDefault();
              onSearch(displayedTimeInputValue);
            }}
          >
            <SearchTimeRangePicker
              inputValue={displayedTimeInputValue}
              setInputValue={setDisplayedTimeInputValue}
              onSearch={range => {
                onSearch(range);
              }}
            />
          </form>
        </Group>
      </div>

      <Group p="xl" pb={0}>
        <div className="fs-8 text-slate-400" style={{ flex: 1 }}>
          Issue
        </div>
        <div
          className="fs-8 text-slate-400"
          style={{ width: COL_USERS_WIDTH, textAlign: 'right' }}
        >
          Users
        </div>
        <div
          className="fs-8 text-slate-400"
          style={{ width: COL_COUNT_WIDTH, textAlign: 'right' }}
        >
          Count
        </div>
        <div
          className="fs-8 text-slate-400"
          style={{ width: COL_VOLUME_WIDTH, textAlign: 'right' }}
        >
          Volume
        </div>
      </Group>
      <Stack p="lg" pt="xs" gap="xs">
        {isPatternsFetching
          ? 'Loading...'
          : patterns?.data.map(pattern => (
              <ExceptionRow
                key={pattern.pattern}
                dateRange={dateRange}
                pattern={pattern}
                onClick={handleExceptionClick}
              />
            ))}
      </Stack>
    </div>
  );
};

const ExceptionsPageDynamic = dynamic(async () => ExceptionsPage, {
  ssr: false,
});

// @ts-ignore
ExceptionsPageDynamic.getLayout = withAppNav;

export default ExceptionsPageDynamic;
