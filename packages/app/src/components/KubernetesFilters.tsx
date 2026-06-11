import React, { useEffect, useMemo, useRef, useState } from 'react';
import { escapeRegExp } from 'lodash';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Group, Select } from '@mantine/core';

import { FilterLinkToggle } from '@/components/FilterLinkToggle';
import SearchInputV2 from '@/components/SearchInput/SearchInputV2';
import { useGetKeyValues } from '@/hooks/useMetadata';

type KubernetesFiltersProps = {
  dateRange: [Date, Date];
  metricSource: TMetricSource;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

// The bundled Kubernetes filter dropdowns, in display order.
const K8S_FILTER_FIELDS = [
  {
    field: 'k8s.pod.name',
    placeholder: 'Pod',
    dataTestId: 'pod-filter-select',
  },
  {
    field: 'k8s.deployment.name',
    placeholder: 'Deployment',
    dataTestId: 'deployment-filter-select',
  },
  {
    field: 'k8s.node.name',
    placeholder: 'Node',
    dataTestId: 'node-filter-select',
  },
  {
    field: 'k8s.namespace.name',
    placeholder: 'Namespace',
    dataTestId: 'namespace-filter-select',
  },
  {
    field: 'k8s.cluster.name',
    placeholder: 'Cluster',
    dataTestId: 'cluster-filter-select',
  },
] as const;

type FilterSelectProps = {
  placeholder: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: string[];
  loading?: boolean;
  dataTestId?: string;
};

// Removes a single field's `resourceAttr.field:"..."` clause from a Lucene
// query string, leaving every other clause (and free-text search) intact. Used
// both to rewrite the query when a dropdown changes and to build the faceted
// free-text `where` for the dropdown value lookup.
export const stripFieldClause = (
  query: string,
  resourceAttr: string,
  field: string,
): string => {
  const fullAttribute = `${resourceAttr}.${field}`;
  const regex = new RegExp(`${escapeRegExp(fullAttribute)}:"[^"]*"`, 'g');
  // Replace with a space and collapse runs of whitespace so removing a clause
  // from the middle of the query doesn't leave a double space.
  return query.replace(regex, ' ').replace(/\s+/g, ' ').trim();
};

const FilterSelect: React.FC<FilterSelectProps> = ({
  placeholder,
  value,
  onChange,
  options,
  loading,
  dataTestId,
}) => {
  const data = useMemo(() => {
    const opts = options
      .map(v => ({ value: v, label: v }))
      .sort((a, b) => a.value.localeCompare(b.value)); // Sort alphabetically for better search results
    // Keep the current selection visible even when it isn't in the (faceted)
    // value list, so the control still reflects what's applied.
    if (value && !opts.some(o => o.value === value)) {
      opts.unshift({ value, label: value });
    }
    return opts;
  }, [options, value]);

  return (
    <Select
      placeholder={placeholder + (loading ? ' (loading...)' : '')}
      data={data}
      value={value}
      onChange={onChange}
      searchable
      clearable
      allowDeselect
      size="xs"
      maxDropdownHeight={280}
      variant="filled"
      w={200}
      limit={100} // Show up to 100 search results
      data-testid={dataTestId}
    />
  );
};

export const KubernetesFilters: React.FC<KubernetesFiltersProps> = ({
  dateRange,
  metricSource,
  searchQuery,
  setSearchQuery,
}) => {
  // State for each filter
  const [podName, setPodName] = useState<string | null>(null);
  const [deploymentName, setDeploymentName] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [namespaceName, setNamespaceName] = useState<string | null>(null);
  const [clusterName, setClusterName] = useState<string | null>(null);

  // "Link" mode (opt-in, off by default): narrow each dropdown's values by the
  // other selections + the free-text search. Off by default because contingent
  // value lookups can't use the cheap per-key rollups and cost far more at scale.
  const [linked, setLinked] = useState(false);

  const resourceAttr = metricSource.resourceAttributesExpression;
  const valueByField: Record<string, string | null> = {
    'k8s.pod.name': podName,
    'k8s.deployment.name': deploymentName,
    'k8s.node.name': nodeName,
    'k8s.namespace.name': namespaceName,
    'k8s.cluster.name': clusterName,
  };
  const setterByField: Record<string, (value: string | null) => void> = {
    'k8s.pod.name': setPodName,
    'k8s.deployment.name': setDeploymentName,
    'k8s.node.name': setNodeName,
    'k8s.namespace.name': setNamespaceName,
    'k8s.cluster.name': setClusterName,
  };

  const { control, setValue } = useForm({
    defaultValues: {
      searchQuery: searchQuery,
    },
  });

  const watchedSearchQuery = useWatch({ control, name: 'searchQuery' });
  const prevSearchQueryRef = useRef(searchQuery);

  // Sync form changes to parent state
  useEffect(() => {
    if (watchedSearchQuery !== prevSearchQueryRef.current) {
      prevSearchQueryRef.current = watchedSearchQuery ?? '';
      setSearchQuery(watchedSearchQuery ?? '');
    }
  }, [watchedSearchQuery, setSearchQuery]);

  // Update search form value when search query changes from parent
  useEffect(() => {
    if (searchQuery !== prevSearchQueryRef.current) {
      prevSearchQueryRef.current = searchQuery;
      setValue('searchQuery', searchQuery);
    }
  }, [searchQuery, setValue]);

  // Helper function to extract value from search query
  const extractValueFromSearchQuery = (
    searchQuery: string,
    resourceAttr: string = '',
    attribute: string,
  ) => {
    const fullAttribute = `${resourceAttr}.${attribute}`;
    const match = searchQuery.match(
      new RegExp(`${escapeRegExp(fullAttribute)}:"([^"]+)"`, 'i'),
    );
    return match ? match[1] : null;
  };

  // Initialize filter values from search query
  useEffect(() => {
    if (searchQuery) {
      for (const { field } of K8S_FILTER_FIELDS) {
        setterByField[field](
          extractValueFromSearchQuery(searchQuery, resourceAttr, field),
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, resourceAttr]);

  const keys = useMemo(
    () => K8S_FILTER_FIELDS.map(({ field }) => `${resourceAttr}['${field}']`),
    [resourceAttr],
  );

  // Faceted (linked) lookups: build a per-field SQL predicate from the OTHER
  // selected fields (exclude-self) so all five value lists are computed in a
  // single `groupUniqArrayIf` scan. The free-text search is applied as a shared
  // WHERE. When unlinked there are no constraints and every dropdown lists all
  // values (still a single batched query).
  const keyConditions = useMemo(() => {
    if (!linked) return undefined;
    return K8S_FILTER_FIELDS.map(({ field }) => {
      const others: FilterState = {};
      for (const { field: otherField } of K8S_FILTER_FIELDS) {
        const value = valueByField[otherField];
        if (otherField !== field && value) {
          others[`${resourceAttr}['${otherField}']`] = {
            included: new Set([value]),
            excluded: new Set(),
          };
        }
      }
      // filtersToQuery only emits `sql` filters (which carry `condition`); the
      // `in` guard narrows away the `sql_ast` member of the Filter union.
      const predicates = filtersToQuery(others, {
        stringifyKeys: false,
      }).flatMap(f => ('condition' in f ? [f.condition] : []));
      return predicates.length
        ? predicates.map(c => `(${c})`).join(' AND ')
        : undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    linked,
    resourceAttr,
    podName,
    deploymentName,
    nodeName,
    namespaceName,
    clusterName,
  ]);

  // Free-text portion of the search (everything except the structured field
  // clauses), applied as a shared WHERE so the dropdowns honor it when linked.
  const facetWhere = useMemo(
    () =>
      linked
        ? K8S_FILTER_FIELDS.reduce(
            (query, { field }) => stripFieldClause(query, resourceAttr, field),
            searchQuery,
          )
        : '',
    [linked, resourceAttr, searchQuery],
  );

  const chartConfig: BuilderChartConfigWithDateRange = useMemo(
    () => ({
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: metricSource.metricTables?.gauge || '',
      },
      where: facetWhere,
      whereLanguage: 'lucene',
      select: '',
      timestampValueExpression: metricSource.timestampValueExpression || '',
      connection: metricSource.connection,
      dateRange,
    }),
    [metricSource, facetWhere, dateRange],
  );

  const { data, isLoading } = useGetKeyValues({
    chartConfig,
    keys,
    keyConditions,
    disableRowLimit: true,
    limit: 1000000,
  });

  const valuesByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of data ?? []) {
      map.set(entry.key, entry.value as string[]);
    }
    return map;
  }, [data]);

  // Helper function to update search query
  const updateSearchQuery = (
    attribute: string,
    value: string | null,
    setter: (value: string | null) => void,
  ) => {
    setter(value);

    const fullAttribute = `${resourceAttr}.${attribute}`;

    // Remove existing filter for this attribute if it exists
    let newQuery = stripFieldClause(searchQuery, resourceAttr, attribute);

    // Add new filter if value is not null
    if (value) {
      newQuery = `${fullAttribute}:"${value}" ${newQuery}`.trim();
    }

    setSearchQuery(newQuery);
  };

  return (
    <Group mt="md" mb="xs" wrap="wrap" gap="xxs">
      {K8S_FILTER_FIELDS.map(({ field, placeholder, dataTestId }) => (
        <FilterSelect
          key={field}
          placeholder={placeholder}
          value={valueByField[field]}
          onChange={value =>
            updateSearchQuery(field, value, setterByField[field])
          }
          options={valuesByKey.get(`${resourceAttr}['${field}']`) ?? []}
          loading={isLoading}
          dataTestId={dataTestId}
        />
      ))}
      <FilterLinkToggle
        linked={linked}
        onChange={setLinked}
        data-testid="k8s-filters-link-toggle"
      />
      <Box style={{ flex: 1, minWidth: 200 }}>
        <SearchInputV2
          tableConnection={tcFromSource(metricSource)}
          placeholder="Search your events w/ Lucene ex. column:foo"
          language="lucene"
          name="searchQuery"
          control={control}
          size="xs"
          enableHotkey
          data-testid="k8s-search-input"
        />
      </Box>
    </Group>
  );
};
