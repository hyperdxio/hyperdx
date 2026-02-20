import { useCallback, useContext, useMemo, useState } from 'react';
import router from 'next/router';
import { useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import get from 'lodash/get';
import {
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
import {
  IconChartLine,
  IconCheck,
  IconCopy,
  IconFilter,
  IconMinus,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTextWrap,
} from '@tabler/icons-react';

import HyperJson, { GetLineActions, LineAction } from '@/components/HyperJson';
import { mergePath } from '@/utils';

type JSONExtractFn =
  | 'JSONExtractString'
  | 'JSONExtractFloat'
  | 'JSONExtractBool';

export function buildJSONExtractQuery(
  keyPath: string[],
  parsedJsonRootPath: string[],
  jsonExtractFn: JSONExtractFn = 'JSONExtractString',
): string | null {
  const nestedPath = keyPath.slice(parsedJsonRootPath.length);
  if (nestedPath.length === 0) {
    return null; // No nested path to extract
  }

  const baseColumn = parsedJsonRootPath[parsedJsonRootPath.length - 1];
  const jsonPathArgs = nestedPath.map(p => `'${p}'`).join(', ');
  return `${jsonExtractFn}(${baseColumn}, ${jsonPathArgs})`;
}

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

function filterBlankValuesRecursively(value: any): any {
  if (value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    const filtered = value
      .map(filterBlankValuesRecursively)
      .filter(v => v !== undefined);

    return filtered.length > 0 ? filtered : undefined;
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {};

    for (const [key, v] of Object.entries(value)) {
      const filtered = filterBlankValuesRecursively(v);
      if (filtered !== undefined) {
        result[key] = filtered;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  return value;
}

const viewerOptionsAtom = atomWithStorage('hdx_json_viewer_options', {
  normallyExpanded: true,
  lineWrap: true,
  tabulate: true,
  filterBlanks: false,
});

function HyperJsonMenu() {
  const [jsonOptions, setJsonOptions] = useAtom(viewerOptionsAtom);

  return (
    <Group>
      <UnstyledButton
        color="gray"
        onClick={() =>
          setJsonOptions({ ...jsonOptions, lineWrap: !jsonOptions.lineWrap })
        }
      >
        <IconTextWrap size={14} />
      </UnstyledButton>
      <Menu width={240} withinPortal={false}>
        <Menu.Target>
          <UnstyledButton>
            <IconSettings size={14} />
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
                <IconCheck size={14} className="ps-2" />
              ) : null
            }
          >
            Expand all properties
          </Menu.Item>
          <Menu.Item
            lh="1"
            py={8}
            rightSection={
              jsonOptions.tabulate ? (
                <IconCheck size={14} className="ps-2" />
              ) : null
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
          <Menu.Item
            lh="1"
            py={8}
            rightSection={
              jsonOptions.filterBlanks ? (
                <IconCheck size={14} className="ps-2" />
              ) : null
            }
            onClick={() =>
              setJsonOptions({
                ...jsonOptions,
                filterBlanks: !jsonOptions.filterBlanks,
              })
            }
          >
            Hide blank values
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
  const jsonOptions = useAtomValue(viewerOptionsAtom);

  const rowData = useMemo(() => {
    if (!data) {
      return null;
    }

    // remove internal aliases (keys that start with __hdx_)
    let cleanedData = Object.fromEntries(
      Object.entries(data).filter(entry => !entry[0].startsWith('__hdx_')),
    );

    // Apply blank value filter if enabled
    if (jsonOptions.filterBlanks) {
      cleanedData = filterBlankValuesRecursively(cleanedData);
    }

    return filterObjectRecursively(cleanedData, debouncedFilter);
  }, [data, debouncedFilter, jsonOptions.filterBlanks]);

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
            <Group gap={2}>
              <IconFilter size={14} />
              Add to Filters
            </Group>
          ),
          title: 'Add to Filters',
          onClick: () => {
            let filterFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              const jsonQuery = buildJSONExtractQuery(
                keyPath,
                parsedJsonRootPath,
              );
              if (jsonQuery) {
                filterFieldPath = jsonQuery;
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
            <Group gap={2}>
              <IconSearch size={14} />
              Search
            </Group>
          ),
          title: 'Search for this value only',
          onClick: () => {
            let searchFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              let jsonExtractFn: JSONExtractFn = 'JSONExtractString';

              if (typeof value === 'number') {
                jsonExtractFn = 'JSONExtractFloat';
              } else if (typeof value === 'boolean') {
                jsonExtractFn = 'JSONExtractBool';
              }

              const jsonQuery = buildJSONExtractQuery(
                keyPath,
                parsedJsonRootPath,
                jsonExtractFn,
              );

              if (jsonQuery) {
                searchFieldPath = jsonQuery;
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
          label: <IconChartLine size={14} />,
          title: 'Chart',
          onClick: () => {
            let chartFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              const jsonQuery = buildJSONExtractQuery(
                keyPath,
                parsedJsonRootPath,
              );
              if (jsonQuery) {
                chartFieldPath = jsonQuery;
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
          const jsonQuery = buildJSONExtractQuery(keyPath, parsedJsonRootPath);
          if (jsonQuery) {
            columnFieldPath = jsonQuery;
          }
        }

        const isIncluded = displayedColumns?.includes(columnFieldPath);
        actions.push({
          key: 'toggle-column',
          label: isIncluded ? (
            <Group gap={2}>
              <IconMinus size={14} />
              Column
            </Group>
          ) : (
            <Group gap={2}>
              <IconPlus size={14} />
              Column
            </Group>
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
        let copiedObj;

        // When in parsed JSON context (e.g., expanded stringified JSON),
        // use the value directly since keyPath doesn't match rowData structure
        if (isInParsedJson && parsedJsonRootPath) {
          copiedObj = value;
        } else {
          // For regular nested objects, use keyPath to navigate rowData
          copiedObj = keyPath.length === 0 ? rowData : get(rowData, keyPath);
        }

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
          label: (
            <Group gap={2}>
              <IconCopy size={14} />
              Copy Value
            </Group>
          ),
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

  return (
    <div className="flex-grow-1 overflow-auto">
      <Box py="xs">
        <Group gap="xs">
          <Input
            size="xs"
            w="100%"
            maw="400px"
            placeholder="Search properties by key or value"
            value={filter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFilter(e.currentTarget.value)
            }
            leftSection={<IconSearch size={16} />}
          />
          {filter && (
            <Button variant="secondary" size="xs" onClick={() => setFilter('')}>
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
