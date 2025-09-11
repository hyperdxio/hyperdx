import { useCallback, useContext, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import router from 'next/router';
import { useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import get from 'lodash/get';
import lucene from '@hyperdx/lucene';
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

// if keep is true, remove node which matched the match condition.
// if value is '', match condition is key equal.
// if value is not '', match condition is key and value equal.
function rangeNodesWithKey(
  ast: any,
  key: string,
  value: string,
  keep: boolean,
): { result: any; modified: boolean } {
  if (!ast) return { result: null, modified: false };

  if (ast.term) {
    let matched = false;
    if (ast.field === key || ast.field === `-${key}`) {
      if (value !== '') {
        if (ast.term === value) {
          matched = true;
        }
      } else {
        matched = true;
      }
    }
    if ((matched && keep) || (!matched && !keep)) {
      return { result: ast, modified: false };
    } else {
      return { result: null, modified: true };
    }
  }

  const leftResult = rangeNodesWithKey(ast.left, key, value, keep);
  const rightResult = rangeNodesWithKey(ast.right, key, value, keep);
  const left = leftResult.result;
  const right = rightResult.result;
  const modified = leftResult.modified || rightResult.modified;

  if (!left && !right) {
    return { result: null, modified: modified };
  }

  if (!left && right) {
    return { result: right, modified: modified };
  }

  if (left && !right) {
    return { result: left, modified: modified };
  }

  return {
    result: {
      ...ast,
      left,
      right,
    },
    modified,
  };
}

// removeLuceneField remove field in a lucene search query.
// modified meaning if it is removed success.
// example:
// removeLuceneField('(ServiceName:a OR ServiceName:b) AND SeverityText:ERROR', 'ServiceName', 'a')
// ServiceName:b AND SeverityText:ERROR
export function removeLuceneField(
  query: string,
  key: string,
  value: string,
): { result: string; modified: boolean } {
  if (typeof query !== 'string') return { result: query, modified: false };

  try {
    // delete matched node
    const ast = lucene.parse(query);
    const { result: modifiedAst, modified } = rangeNodesWithKey(
      ast,
      key,
      value,
      false,
    );

    if (!modifiedAst) {
      return { result: '', modified: modified };
    }

    const modifiedString = lucene.toString(modifiedAst);
    return { result: modifiedString, modified };
  } catch (error) {
    console.warn('Failed to parse Lucene query', error);

    return { result: query, modified: false };
  }
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

  const searchParams = useSearchParams();

  const getLineActions = useCallback<GetLineActions>(
    ({ keyPath, value }) => {
      const actions: LineAction[] = [];
      const fieldPath = mergePath(keyPath, jsonColumns);
      const isJsonColumn =
        keyPath.length > 0 && jsonColumns?.includes(keyPath[0]);

      let where = searchParams.get('where') || '';
      let whereLanguage = searchParams.get('whereLanguage');
      if (whereLanguage == '') {
        whereLanguage = 'lucene';
      }

      let luceneFieldPath = '';
      if (whereLanguage === 'lucene') {
        luceneFieldPath = keyPath.join('.');
      }

      let removedFilterWhere = ''; // filter which already removed value.
      let hadFilter = false;
      if (where !== '') {
        // if it is lucene, we support remove-filter.
        if (whereLanguage === 'lucene') {
          const { result, modified } = removeLuceneField(
            where,
            luceneFieldPath,
            value,
          );
          removedFilterWhere = result;
          hadFilter = modified;
          where += ' ';
        } else {
          where += ' AND ';
        }
      }

      if (generateSearchUrl && typeof value !== 'object' && hadFilter) {
        actions.push({
          key: 'remove-filter',
          label: (
            <>
              <i className="bi bi-x-circle me-1" />
              Remove Filter
            </>
          ),
          onClick: () => {
            router.push(
              generateSearchUrl({
                where: removedFilterWhere,
                whereLanguage: whereLanguage as 'sql' | 'lucene',
              }),
            );
          },
        });
      }

      if (generateSearchUrl && typeof value !== 'object' && !hadFilter) {
        actions.push({
          key: 'filter',
          label: (
            <>
              <i className="bi bi-search me-1" />
              Filter
            </>
          ),
          title: 'Add to Filters',
          onClick: () => {
            if (whereLanguage === 'lucene') {
              where += `${luceneFieldPath}:"${value}"`;
            } else {
              where += `${fieldPath} = ${
                typeof value === 'string' ? `'${value}'` : value
              }`;
            }

            router.push(
              generateSearchUrl({
                where: where,
                whereLanguage: whereLanguage as 'sql' | 'lucene',
              }),
            );
          },
        });
      }

      if (generateSearchUrl && typeof value !== 'object' && !hadFilter) {
        actions.push({
          key: 'exclude',
          label: (
            <>
              <i className="bi bi-dash-circle me-1" />
              Exclude
            </>
          ),
          title: 'Exclude from Filters',
          onClick: () => {
            if (whereLanguage === 'lucene') {
              where += `-${luceneFieldPath}:"${value}"`;
            } else {
              where += `${fieldPath} != ${
                typeof value === 'string' ? `'${value}'` : value
              }`;
            }

            router.push(
              generateSearchUrl({
                where: where,
                whereLanguage: whereLanguage as 'sql' | 'lucene',
              }),
            );
          },
        });
      }

      if (generateSearchUrl && typeof value !== 'object' && !hadFilter) {
        actions.push({
          key: 'replace-filter',
          label: (
            <>
              <i className="bi bi-arrow-counterclockwise me-1" />
              Replace Filter
            </>
          ),
          title: 'Search for this value only',
          onClick: () => {
            where = '';
            if (whereLanguage === 'lucene') {
              where = `${luceneFieldPath}:"${value}"`;
            } else {
              where = `${fieldPath} = ${
                typeof value === 'string' ? `'${value}'` : value
              }`;
            }

            router.push(
              generateSearchUrl({
                where: where,
                whereLanguage: whereLanguage as 'sql' | 'lucene',
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
                field: fieldPath,
                groupBy: [],
              }),
            );
          },
        });
      }

      // Toggle column action (non-object values)
      if (toggleColumn && typeof value !== 'object') {
        const isIncluded = displayedColumns?.includes(fieldPath);
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
            toggleColumn(fieldPath);
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
          label: (
            <>
              <i className="bi bi-clipboard me-1" />
              Copy Object
            </>
          ),
          onClick: handleCopyObject,
        });
      } else {
        actions.push({
          key: 'copy-value',
          label: (
            <>
              <i className="bi bi-copy me-1" />
              Copy Value
            </>
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
