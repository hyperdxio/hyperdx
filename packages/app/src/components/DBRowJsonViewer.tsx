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

import HyperJson, {
  FormatLeafValue,
  GetLineActions,
  LineAction,
} from '@/components/HyperJson';
import { useFormatTime } from '@/useFormatTime';
import { mergePath } from '@/utils';
import {
  CLIPBOARD_ERROR_MESSAGE,
  copyTextToClipboard,
} from '@/utils/clipboard';

type JSONExtractFn =
  | 'JSONExtractString'
  | 'JSONExtractFloat'
  | 'JSONExtractBool';

export function buildJSONExtractQuery(
  keyPath: string[],
  parsedJsonRootPath: string[],
  jsonColumns: string[] = [],
  jsonExtractFn: JSONExtractFn = 'JSONExtractString',
  mapColumns: string[] = [],
): string | null {
  const nestedPath = keyPath.slice(parsedJsonRootPath.length);
  if (nestedPath.length === 0) {
    return null; // No nested path to extract
  }

  // `parsedJsonRootPath[0]` is the column the parsed-JSON view is anchored on.
  // It can be a JSON column (auto-detected by ClickHouse JSON type) OR a Map
  // column whose sub-value is a JSON-parseable string (HyperJson promotes those
  // to `isInParsedJson=true`, see HyperJson.tsx:227). Thread `mapColumns` so a
  // numeric-looking Map sub-key renders as `Map['1']` instead of the array
  // `Map[2]`. See HDX-4369.
  const baseColumn = mergePath(parsedJsonRootPath, jsonColumns, mapColumns);
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

type ViewerOptions = {
  normallyExpanded: boolean;
  whiteSpace?: 'pre' | 'pre-wrap';
  tabulate: boolean;
  filterBlanks: boolean;
};

const VIEWER_OPTIONS_KEY = 'hdx_json_viewer_options';

const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  normallyExpanded: true,
  whiteSpace: 'pre-wrap',
  tabulate: true,
  filterBlanks: false,
};

/**
 * Migrates old `lineWrap` boolean to `whiteSpace` enum.
 *
 * Old behavior was inverted:
 *   lineWrap: true  → white-space: pre (no wrapping) — was the default
 *   lineWrap: false → word-break: break-all (wrapping, but collapsed whitespace)
 *
 * New behavior:
 *   whiteSpace: 'pre'      → preserve formatting, no wrapping
 *   whiteSpace: 'pre-wrap'  → preserve formatting + wrap long lines
 *   whiteSpace: undefined   → use default ('pre-wrap'), or future team default
 */
/** @internal Exported for testing only */
export function migrateViewerOptions(
  stored: string | null,
): ViewerOptions | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return null;

    if ('lineWrap' in parsed) {
      const { lineWrap, ...rest } = parsed;
      const migrated: ViewerOptions = {
        ...DEFAULT_VIEWER_OPTIONS,
        ...rest,
        // Old lineWrap: true meant no-wrap (was default) → undefined (inherit default)
        // Old lineWrap: false meant user wanted wrapping → 'pre-wrap'
        whiteSpace: lineWrap === false ? 'pre-wrap' : undefined,
      };
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(VIEWER_OPTIONS_KEY, JSON.stringify(migrated));
        }
      } catch {
        // Ignore localStorage errors
      }
      return migrated;
    }

    return parsed as ViewerOptions;
  } catch {
    return null;
  }
}

// Custom storage adapter to migrate old `lineWrap` boolean to `whiteSpace` enum
// on first read, before React renders (avoids flash of wrong state).
const viewerOptionsStorage = {
  getItem: (key: string, initialValue: ViewerOptions): ViewerOptions => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const stored = localStorage.getItem(key);
      return migrateViewerOptions(stored) ?? initialValue;
    } catch {
      return initialValue;
    }
  },
  setItem: (key: string, value: ViewerOptions): void => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      // Ignore localStorage errors
    }
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore localStorage errors
    }
  },
};

const viewerOptionsAtom = atomWithStorage<ViewerOptions>(
  VIEWER_OPTIONS_KEY,
  DEFAULT_VIEWER_OPTIONS,
  viewerOptionsStorage,
);

function HyperJsonMenu({ rowData }: { rowData: any }) {
  const [jsonOptions, setJsonOptions] = useAtom(viewerOptionsAtom);
  const effectiveWhiteSpace = jsonOptions.whiteSpace ?? 'pre-wrap';

  return (
    <Group>
      {rowData != null && (
        <UnstyledButton
          onClick={async () => {
            const copied = await copyTextToClipboard(
              typeof rowData === 'string'
                ? rowData
                : JSON.stringify(rowData, null, 2),
            );
            if (!copied) {
              notifications.show({
                color: 'red',
                message: CLIPBOARD_ERROR_MESSAGE,
              });
              return;
            }
            notifications.show({
              color: 'green',
              message: `Value copied to clipboard`,
            });
          }}
          variant="copy"
          title={'Copy row as JSON'}
        >
          <IconCopy size={14} />
        </UnstyledButton>
      )}
      <UnstyledButton
        color="gray"
        data-testid="json-viewer-wrap-toggle"
        onClick={() =>
          setJsonOptions({
            ...jsonOptions,
            whiteSpace: effectiveWhiteSpace === 'pre-wrap' ? 'pre' : 'pre-wrap',
          })
        }
        style={{
          opacity: effectiveWhiteSpace === 'pre-wrap' ? 1 : 0.5,
        }}
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
  jsonColumns,
  mapColumns,
}: {
  data: any;
  jsonColumns?: string[];
  // Map column names from the result-set metadata. Threaded into
  // `mergePath` so numeric-looking sub-keys on a Map render as
  // `Map['key']` instead of the array `Map[N+1]`. HDX-4369.
  mapColumns?: string[];
}) {
  const formatTime = useFormatTime();
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

  const formatLeafValue = useCallback<FormatLeafValue>(
    ({ keyName, keyPath, value }) => {
      if (
        keyPath.length !== 1 ||
        (keyName !== 'Timestamp' && keyName !== 'TimestampTime')
      ) {
        return undefined;
      }

      if (typeof value !== 'string' || value.length === 0) {
        return undefined;
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return undefined;
      }

      return formatTime(date, { format: 'withMs' });
    },
    [formatTime],
  );

  const getLineActions = useCallback<GetLineActions>(
    ({ keyPath, value, isInParsedJson, parsedJsonRootPath }) => {
      const actions: LineAction[] = [];
      const fieldPath = mergePath(keyPath, jsonColumns, mapColumns);
      const isJsonColumn =
        keyPath.length > 0 && jsonColumns?.includes(keyPath[0]);

      // Add to Filters action
      // FIXME: TOTAL HACK To disallow adding timestamp to filters
      if (
        onPropertyAddClick != null &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean') &&
        value !== '' &&
        value != null &&
        fieldPath != 'Timestamp' &&
        fieldPath != 'TimestampTime'
      ) {
        actions.push({
          key: 'add-to-search',
          label: <IconFilter size={14} />,
          title: 'Add to Filters',
          onClick: () => {
            let filterFieldPath = fieldPath;

            // Handle parsed JSON from string columns using JSONExtractString
            if (isInParsedJson && parsedJsonRootPath) {
              const jsonQuery = buildJSONExtractQuery(
                keyPath,
                parsedJsonRootPath,
                jsonColumns,
                'JSONExtractString',
                mapColumns,
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

            onPropertyAddClick(filterFieldPath, String(value));
            notifications.show({
              color: 'green',
              message: `Added "${fieldPath} = ${String(value)}" to filters`,
            });
          },
        });
      }

      if (generateSearchUrl && typeof value !== 'object') {
        actions.push({
          key: 'search',
          label: <IconSearch size={14} />,
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
                jsonColumns,
                jsonExtractFn,
                mapColumns,
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
                jsonColumns,
                'JSONExtractString',
                mapColumns,
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
          const jsonQuery = buildJSONExtractQuery(
            keyPath,
            parsedJsonRootPath,
            jsonColumns,
            'JSONExtractString',
            mapColumns,
          );
          if (jsonQuery) {
            columnFieldPath = jsonQuery;
          }
        }

        const isIncluded = displayedColumns?.includes(columnFieldPath);
        actions.push({
          key: 'toggle-column',
          label: isIncluded ? <IconMinus size={14} /> : <IconPlus size={14} />,
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

      const handleCopyObject = async () => {
        let copiedObj;

        // When in parsed JSON context (e.g., expanded stringified JSON),
        // use the value directly since keyPath doesn't match rowData structure
        if (isInParsedJson && parsedJsonRootPath) {
          copiedObj = value;
        } else {
          // For regular nested objects, use keyPath to navigate rowData
          copiedObj = keyPath.length === 0 ? rowData : get(rowData, keyPath);
        }

        const copied = await copyTextToClipboard(
          JSON.stringify(copiedObj, null, 2),
        );
        if (!copied) {
          notifications.show({
            color: 'red',
            message: CLIPBOARD_ERROR_MESSAGE,
          });
          return;
        }
        notifications.show({
          color: 'green',
          message: `Copied object to clipboard`,
        });
      };

      if (typeof value === 'object') {
        actions.push({
          key: 'copy-object',
          label: <IconCopy size={14} />,
          title: 'Copy object',
          onClick: handleCopyObject,
        });
      } else {
        actions.push({
          key: 'copy-value',
          label: <IconCopy size={14} />,
          title: 'Copy value',
          onClick: async () => {
            const copied = await copyTextToClipboard(
              typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2),
            );
            if (!copied) {
              notifications.show({
                color: 'red',
                message: CLIPBOARD_ERROR_MESSAGE,
              });
              return;
            }
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
      mapColumns,
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
          <HyperJsonMenu rowData={rowData} />
        </Group>
      </Box>
      <Paper bg="transparent" mt="sm">
        {rowData != null ? (
          <HyperJson
            data={rowData}
            getLineActions={getLineActions}
            formatLeafValue={formatLeafValue}
            {...jsonOptions}
          />
        ) : (
          <Text>No data</Text>
        )}
      </Paper>
    </div>
  );
}
