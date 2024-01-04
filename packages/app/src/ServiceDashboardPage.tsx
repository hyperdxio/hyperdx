import * as React from 'react';
import Head from 'next/head';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Group, Select, Tabs } from '@mantine/core';

import AppNav from './AppNav';
import SearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';

import styles from '../styles/ServiceDashboardPage.module.scss';

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const MOCK_SERVICES = Array.from({ length: 100 }).map((_, i) => ({
  value: `service-${i}`,
  label: `service-${i}`,
}));

export default function ServiceDashboardPage() {
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const [_searchQuery, _setSearchQuery] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useQueryParam(
    'q',
    withDefault(StringParam, ''),
    { updateType: 'replaceIn' },
  );
  const [service, setService] = useQueryParam(
    'service',
    withDefault(StringParam, ''),
    { updateType: 'replaceIn' },
  );

  const onSearchSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearchQuery(_searchQuery || null);
    },
    [_searchQuery, setSearchQuery],
  );

  const {
    searchedTimeRange,
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

  return (
    <div>
      <Head>
        <title>Service Dashboard - HyperDX</title>
      </Head>
      <div className="d-flex">
        <AppNav fixed />
        <div className="w-100">
          <div className="d-flex flex-column">
            <Group
              px="md"
              py="xs"
              className="border-bottom border-dark"
              spacing="xs"
              align="center"
            >
              {/* Use Autocomplete instead? */}
              <Select
                searchable
                clearable
                allowDeselect
                placeholder="All Services"
                maxDropdownHeight={280}
                data={MOCK_SERVICES}
                radius="md"
                variant="filled"
                value={service}
                onChange={v => setService(v)}
              />
              <div style={{ flex: 1 }}>
                <form onSubmit={onSearchSubmit}>
                  <SearchInput
                    inputRef={searchInputRef}
                    placeholder="Scope dashboard to..."
                    value={_searchQuery ?? searchQuery}
                    onChange={v => _setSearchQuery(v)}
                    onSearch={() => {}}
                    showHotkey={false}
                  />
                </form>
              </div>
              <div className="d-flex" style={{ width: 350, height: 36 }}>
                <SearchTimeRangePicker
                  inputValue={displayedTimeInputValue}
                  setInputValue={setDisplayedTimeInputValue}
                  onSearch={range => {
                    onSearch(range);
                  }}
                />
              </div>
            </Group>
          </div>
          <Tabs
            color="gray"
            variant="pills"
            defaultValue="infrastructure"
            radius="md"
          >
            <div className="px-3 py-2 border-bottom border-dark">
              <Tabs.List>
                <Tabs.Tab value="infrastructure">Infrastructure</Tabs.Tab>
                <Tabs.Tab value="http">HTTP Service</Tabs.Tab>
                <Tabs.Tab value="database">Database</Tabs.Tab>
              </Tabs.List>
            </div>

            <div className="p-3">
              <Tabs.Panel value="infrastructure">
                <pre>
                  {JSON.stringify(
                    { searchedTimeRange, searchQuery, service },
                    null,
                    4,
                  )}
                </pre>
              </Tabs.Panel>
              <Tabs.Panel value="http">HTTP Service</Tabs.Panel>
              <Tabs.Panel value="database">Database</Tabs.Panel>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
