import { useMemo, useState } from 'react';
import type {
  BuilderChartConfigWithDateRange,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';
import { Button, Code, Collapse, Group, Text } from '@mantine/core';

import type { FilterStateHook } from '@/searchFilters';

import { AddFilterControl } from './AddFilterControl';
import type { QueryLanguage } from './QueryEditor';
import {
  filterStateToLucene,
  filterStateToSql,
  getFilterExampleQueries,
  type QueryEditorMode,
} from './queryModeSafety';

export function QueryEditorToolbar({
  mode,
  language,
  where,
  onWhereChange,
  sourceKind,
  fields,
  searchFilters,
  chartConfig,
  queryMode,
}: {
  mode: QueryEditorMode;
  language: QueryLanguage;
  where: string;
  onWhereChange: (where: string) => void;
  sourceKind?: SourceKind;
  fields: string[];
  searchFilters?: FilterStateHook;
  chartConfig?: BuilderChartConfigWithDateRange;
  queryMode?: 'builder' | 'sql';
}) {
  const [sqlOpened, setSqlOpened] = useState(false);
  const examples = getFilterExampleQueries(sourceKind);
  const filters = useMemo(
    () => searchFilters?.filters ?? {},
    [searchFilters?.filters],
  );
  const hasFilters = Object.keys(filters).length > 0;

  const sqlPreview = useMemo(() => {
    const filterSql = filterStateToSql(filters);
    if (queryMode === 'sql') {
      return filterSql
        ? `${filterSql}\n-- chips apply through $__filters`
        : '-- chips apply through $__filters in the raw SQL';
    }
    if (language === 'sql') {
      return [where.trim(), filterSql].filter(Boolean).join(' AND ');
    }
    const lucene = [where.trim(), filterStateToLucene(filters)]
      .filter(Boolean)
      .join(' AND ');
    return [lucene && `-- search: ${lucene}`, filterSql]
      .filter(Boolean)
      .join('\n');
  }, [filters, language, queryMode, where]);

  const handleExample = (lucene: string) => {
    if (mode !== 'lucene') {
      return;
    }
    const trimmed = where.trim();
    onWhereChange(trimmed ? `${trimmed} AND ${lucene}` : lucene);
  };

  return (
    <>
      <Group gap="xs" wrap="wrap">
        {searchFilters != null && (
          <AddFilterControl
            fields={fields}
            searchFilters={searchFilters}
            chartConfig={chartConfig}
          />
        )}
        {mode === 'lucene' &&
          examples.map(example => (
            <Button
              key={example.lucene}
              variant="subtle"
              size="compact-xs"
              onClick={() => handleExample(example.lucene)}
            >
              {example.label}
            </Button>
          ))}
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => setSqlOpened(open => !open)}
        >
          {sqlOpened ? 'Hide SQL' : 'Show SQL'}
        </Button>
      </Group>
      {mode === 'lucene' && !where.trim() && !hasFilters && (
        <Text size="xs" c="dimmed">
          Filter this source. Add a filter or type a search query.
        </Text>
      )}
      <Collapse expanded={sqlOpened}>
        <Code block>{sqlPreview || '-- no filters'}</Code>
      </Collapse>
    </>
  );
}
