import { useCallback, useContext, useMemo, useState } from 'react';
import router from 'next/router';
import { useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import get from 'lodash/get';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Input,
  Menu,
  Paper,
  Text,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';

import HyperJson, { GetLineActions, LineAction } from '@/components/HyperJson';
import { mergePath } from '@/utils';

import { RowSidePanelContext } from './DBRowSidePanel';

function filterObjectRecursively(obj: any, filter: string): any {
  if (typeof obj !== 'object' || obj === null || filter === '') {
    return obj;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      continue;
    }
    if (
      key.toLowerCase().includes(filter.toLowerCase()) ||
      (typeof value === 'string' &&
        value.toLowerCase().includes(filter.toLowerCase()))
    ) {
      result[key] = value;
    }
    if (typeof value === 'object') {
      const v = filterObjectRecursively(value, filter);
      // Skip empty objects
      if (Object.keys(v).length > 0) {
        result[key] = v;
      }
    }
  }

  return result;
}

const viewerOptionsAtom = atomWithStorage('hdx_json_viewer_options', {
  normallyExpanded: true,
  lineWrap: true,
  tabulate: true,
});

function HyperJsonMenu() {
  const [jsonOptions, setJsonOptions] = useAtom(viewerOptionsAtom);

  return (
    <Menu width={240} withinPortal={false}>
      <Menu.Target>
        <ActionIcon size="md" variant="filled" color="gray">
          <i className="bi bi-gear" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label lh={1} py={6}>
          Properties view options
        </Menu.Label>
        <Menu.Item
          onClick={() =>
            setJsonOptions({
              ...jsonOptions,
              normallyExpanded: !jsonOptions.normallyExpanded,
            })
          }
          lh="1"
          py={8}
          rightSection={
            jsonOptions.normallyExpanded ? (
              <i className="ps-2 bi bi-check2" />
            ) : null
          }
        >
          Expand all properties
        </Menu.Item>
        <Menu.Item
          onClick={() =>
            setJsonOptions({
              ...jsonOptions,
              lineWrap: !jsonOptions.lineWrap,
            })
          }
          lh="1"
          py={8}
          rightSection={
            jsonOptions.lineWrap ? <i className="ps-2 bi bi-check2" /> : null
          }
        >
          Preserve line breaks
        </Menu.Item>
        <Menu.Item
          lh="1"
          py={8}
          rightSection={
            jsonOptions.tabulate ? <i className="ps-2 bi bi-check2" /> : null
          }
          onClick={() =>
            setJsonOptions({
              ...jsonOptions,
              tabulate: !jsonOptions.tabulate,
            })
          }
        >
          Tabulate
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function DBRowJsonViewer({ data }: { data: any }) {
  const {
    onPropertyAddClick,
    generateSearchUrl,
    generateChartUrl,
    displayedColumns,
    toggleColumn,
  } = useContext(RowSidePanelContext);

  const [filter, setFilter] = useState<string>('');
  const [debouncedFilter] = useDebouncedValue(filter, 100);

  const rowData = useMemo(() => {
    if (!data) {
      return null;
    }

    // remove internal aliases (keys that start with __hdx_)
    Object.keys(data).forEach(key => {
      if (key.startsWith('__hdx_')) {
        delete data[key];
      }
    });

    return filterObjectRecursively(data, debouncedFilter);
  }, [data, debouncedFilter]);

  const getLineActions = useCallback<GetLineActions>(
    ({ keyPath, value }) => {
      const actions: LineAction[] = [];

      // only strings for now
      if (onPropertyAddClick != null && typeof value === 'string' && value) {
        actions.push({
          key: 'add-to-search',
          label: (
            <>
              <i className="bi bi-funnel-fill me-1" />
              Add to Filters
            </>
          ),
          title: 'Add to Filters',
          onClick: () => {
            onPropertyAddClick(mergePath(keyPath), value);
            notifications.show({
              color: 'green',
              message: `Added "${mergePath(keyPath)} = ${value}" to filters`,
            });
          },
        });
      }

      if (generateSearchUrl && typeof value !== 'object') {
        actions.push({
          key: 'search',
          label: (
            <>
              <i className="bi bi-search me-1" />
              Search
            </>
          ),
          title: 'Search for this value only',
          onClick: () => {
            router.push(
              generateSearchUrl({
                where: `${mergePath(keyPath)} = ${
                  typeof value === 'string' ? `'${value}'` : value
                }`,
                whereLanguage: 'sql',
              }),
            );
          },
        });
      }

      /* TODO: Handle bools properly (they show up as number...) */
      if (generateChartUrl && typeof value === 'number') {
        actions.push({
          key: 'chart',
          label: <i className="bi bi-graph-up" />,
          title: 'Chart',
          onClick: () => {
            router.push(
              generateChartUrl({
                aggFn: 'avg',
                field: `${keyPath.join('.')}`,
                groupBy: [],
              }),
            );
          },
        });
      }

      if (toggleColumn && typeof value !== 'object') {
        const keyPathString = mergePath(keyPath);
        const isIncluded = displayedColumns?.includes(keyPathString);
        actions.push({
          key: 'toggle-column',
          label: isIncluded ? (
            <>
              <i className="bi bi-dash fs-7 me-1" />
              Column
            </>
          ) : (
            <>
              <i className="bi bi-plus fs-7 me-1" />
              Column
            </>
          ),
          title: isIncluded
            ? `Remove ${keyPathString} column from results table`
            : `Add ${keyPathString} column to results table`,
          onClick: () => {
            toggleColumn(keyPathString);
            notifications.show({
              color: 'green',
              message: `Column "${keyPathString}" ${
                isIncluded ? 'removed from' : 'added to'
              } results table`,
            });
          },
        });
      }

      const handleCopyObject = () => {
        const copiedObj =
          keyPath.length === 0 ? rowData : get(rowData, keyPath);
        window.navigator.clipboard.writeText(
          JSON.stringify(copiedObj, null, 2),
        );
        notifications.show({
          color: 'green',
          message: `Copied object to clipboard`,
        });
      };

      if (typeof value === 'object') {
        actions.push({
          key: 'copy-object',
          label: 'Copy Object',
          onClick: handleCopyObject,
        });
      } else {
        actions.push({
          key: 'copy-value',
          label: 'Copy Value',
          onClick: () => {
            window.navigator.clipboard.writeText(
              typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2),
            );
            notifications.show({
              color: 'green',
              message: `Value copied to clipboard`,
            });
          },
        });
      }

      return actions;
    },
    [
      displayedColumns,
      generateChartUrl,
      generateSearchUrl,
      onPropertyAddClick,
      rowData,
      toggleColumn,
    ],
  );

  const jsonOptions = useAtomValue(viewerOptionsAtom);

  return (
    <div className="flex-grow-1 bg-body overflow-auto">
      <Box py="xs">
        <Group gap="xs">
          <Input
            size="xs"
            w="100%"
            maw="400px"
            placeholder="Search properties by key or value"
            value={filter}
            onChange={e => setFilter(e.currentTarget.value)}
            leftSection={<i className="bi bi-search" />}
          />
          {filter && (
            <Button
              variant="filled"
              color="gray"
              size="xs"
              onClick={() => setFilter('')}
            >
              Clear
            </Button>
          )}
          <div className="flex-grow-1" />
          <HyperJsonMenu />
        </Group>
      </Box>
      <Paper bg="transparent" mt="sm">
        {rowData != null ? (
          <HyperJson
            data={rowData}
            getLineActions={getLineActions}
            {...jsonOptions}
          />
        ) : (
          <Text>No data</Text>
        )}
      </Paper>
    </div>
  );
}
