import * as React from 'react';
import Head from 'next/head';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Group, Tabs } from '@mantine/core';

import { withAppNav } from './layout';
import HdxSearchInput from './SearchInput';
import SearchTimeRangePicker from './SearchTimeRangePicker';
import { parseTimeQuery, useTimeQuery } from './timeQuery';

const SearchInput = React.memo(
  ({
    searchQuery,
    setSearchQuery,
  }: {
    searchQuery: string;
    setSearchQuery: (q: string | null) => void;
  }) => {
    const [_searchQuery, _setSearchQuery] = React.useState<string | null>(null);
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    const onSearchSubmit = React.useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        setSearchQuery(_searchQuery || null);
      },
      [_searchQuery, setSearchQuery],
    );

    return (
      <form onSubmit={onSearchSubmit}>
        <HdxSearchInput
          inputRef={searchInputRef}
          placeholder="Scope dashboard to..."
          value={_searchQuery ?? searchQuery}
          onChange={v => _setSearchQuery(v)}
          onSearch={() => {}}
          showHotkey={false}
        />
      </form>
    );
  },
);

const defaultTimeRange = parseTimeQuery('Past 1h', false);

export default function KubernetesDashboardPage() {
  const [activeTab, setActiveTab] = useQueryParam(
    'tab',
    withDefault(StringParam, 'pods'),
    { updateType: 'replaceIn' },
  );

  const [searchQuery, setSearchQuery] = useQueryParam(
    'q',
    withDefault(StringParam, ''),
    { updateType: 'replaceIn' },
  );

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

  return (
    <div>
      <Head>
        <title>Kubernetes Dashboard</title>
      </Head>
      <div className="d-flex flex-column">
        <Group
          px="md"
          py="xs"
          className="border-bottom border-dark"
          spacing="xs"
          align="center"
        >
          <div style={{ flex: 1 }}>
            <SearchInput
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
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
        keepMounted={false}
        value={activeTab}
        onTabChange={setActiveTab}
      >
        <div className="px-3 py-2 border-bottom border-dark">
          <Tabs.List>
            <Tabs.Tab value="pods">Pods</Tabs.Tab>
            <Tabs.Tab value="nodes">Nodes</Tabs.Tab>
            <Tabs.Tab value="namespaces">Namespaces</Tabs.Tab>
            <Tabs.Tab value="clusters">Clusters</Tabs.Tab>
          </Tabs.List>
        </div>

        <div className="p-3">
          <Tabs.Panel value="pods">Pods</Tabs.Panel>
          <Tabs.Panel value="nodes">Nodes</Tabs.Panel>
          <Tabs.Panel value="namespaces">Namespaces</Tabs.Panel>
          <Tabs.Panel value="clusters">Clusters</Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}

KubernetesDashboardPage.getLayout = withAppNav;
