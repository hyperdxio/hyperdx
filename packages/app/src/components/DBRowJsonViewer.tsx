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
  UnstyledButton,
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
    <Group>
      <UnstyledButton
        color="gray.0"
        onClick={() =>
          setJsonOptions({ ...jsonOptions, lineWrap: !jsonOptions.lineWrap })
        }
      >
        <i className="bi bi-text-wrap" />
      </UnstyledButton>
      <Menu width={240} withinPortal={false}>
        <Menu.Target>
          <UnstyledButton>
            <i className="bi bi-gear" />
          </UnstyledButton>
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
    </Group>
  );
}

export function DBRowJsonViewer({
  data,
  jsonColumns = [],
}: {
  data: any;
  jsonColumns?: string[];
}) {
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
    ({ keyPath, value, isInParsedJson, parsedJsonRootPath }) => {
      const actions: LineAction[] = [];
      const fieldPath = mergePath(keyPath, jsonColumns);
      const isJsonColumn =
        keyPath.length > 0 && jsonColumns?.includes(keyPath[0]);

      // Add to Filters action (strings only)
      // FIXME: TOTAL HACK To disallow adding timestamp to filters
      if (
        onPropertyAddClick != null &&
        typeof value === 'string' &&
        value &&
        fieldPath != 'Timestamp' &&
        fieldPath != 'TimestampTime'
      ) {
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
            let filterFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              // Extract the nested path within the parsed JSON
              const nestedPath = keyPath.slice(parsedJsonRootPath.length);
              if (nestedPath.length > 0) {
                // Build JSONExtractString query for the nested path
                const baseColumn =
                  parsedJsonRootPath[parsedJsonRootPath.length - 1];
                const jsonPathArgs = nestedPath.map(p => `'${p}'`).join(', ');
                filterFieldPath = `JSONExtractString(${baseColumn}, ${jsonPathArgs})`;
              } else {
                // We're at the root of the parsed JSON, treat as string
                filterFieldPath = isJsonColumn
                  ? `toString(${fieldPath})`
                  : fieldPath;
              }
            } else {
              // Regular JSON column or non-JSON field
              filterFieldPath = isJsonColumn
                ? `toString(${fieldPath})`
                : fieldPath;
            }

            onPropertyAddClick(filterFieldPath, value);
            notifications.show({
              color: 'green',
              message: `Added "${fieldPath} = ${value}" to filters`,
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
            let searchFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              const nestedPath = keyPath.slice(parsedJsonRootPath.length);
              if (nestedPath.length > 0) {
                const baseColumn =
                  parsedJsonRootPath[parsedJsonRootPath.length - 1];
                const jsonPathArgs = nestedPath.map(p => `'${p}'`).join(', ');
                searchFieldPath = `JSONExtractString(${baseColumn}, ${jsonPathArgs})`;
              }
            }

            let defaultWhere = `${searchFieldPath} = ${
              typeof value === 'string' ? `'${value}'` : value
            }`;

            // FIXME: TOTAL HACK
            if (
              searchFieldPath == 'Timestamp' ||
              searchFieldPath == 'TimestampTime'
            ) {
              defaultWhere = `${searchFieldPath} = parseDateTime64BestEffort('${value}', 9)`;
            }
            router.push(
              generateSearchUrl({
                where: defaultWhere,
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
            let chartFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              const nestedPath = keyPath.slice(parsedJsonRootPath.length);
              if (nestedPath.length > 0) {
                const baseColumn =
                  parsedJsonRootPath[parsedJsonRootPath.length - 1];
                const jsonPathArgs = nestedPath.map(p => `'${p}'`).join(', ');
                chartFieldPath = `JSONExtractString(${baseColumn}, ${jsonPathArgs})`;
              }
            }

            router.push(
              generateChartUrl({
                aggFn: 'avg',
                field: chartFieldPath,
                groupBy: [],
              }),
            );
          },
        });
      }

      // Toggle column action (non-object values)
      if (toggleColumn && typeof value !== 'object') {
        let columnFieldPath = fieldPath;

        // Handle parsed JSON from string columns using JSONExtractString
        if (isInParsedJson && parsedJsonRootPath) {
          const nestedPath = keyPath.slice(parsedJsonRootPath.length);
          if (nestedPath.length > 0) {
            const baseColumn =
              parsedJsonRootPath[parsedJsonRootPath.length - 1];
            const jsonPathArgs = nestedPath.map(p => `'${p}'`).join(', ');
            columnFieldPath = `JSONExtractString(${baseColumn}, ${jsonPathArgs})`;
          }
        }

        const isIncluded = displayedColumns?.includes(columnFieldPath);
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
            ? `Remove ${fieldPath} column from results table`
            : `Add ${fieldPath} column to results table`,
          onClick: () => {
            toggleColumn(columnFieldPath);
            notifications.show({
              color: 'green',
              message: `Column "${fieldPath}" ${
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
      jsonColumns,
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
