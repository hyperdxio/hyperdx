import React, { useEffect, useMemo, useRef, useState } from 'react';
import { escapeRegExp } from 'lodash';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
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

type FilterSelectProps = {
  metricSource: TMetricSource;
  placeholder: string;
  fieldName: string;
  value: string | null;
  onChange: (value: string | null) => void;
  chartConfig: BuilderChartConfigWithDateRange;
  dataTestId?: string;
  /** Lazy (link) mode: only fetch this dropdown's values once it's opened. */
  lazy?: boolean;
};

// Removes a single field's `resourceAttr.field:"..."` clause from a Lucene
// query string, leaving every other clause (and free-text search) intact. Used
// both to rewrite the query when a dropdown changes and to build the faceted
// `where` for each dropdown's value lookup.
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
  metricSource,
  placeholder,
  fieldName,
  value,
  onChange,
  chartConfig,
  dataTestId,
  lazy,
}) => {
  const [opened, setOpened] = useState(false);
  const { data, isLoading } = useGetKeyValues(
    {
      chartConfig,
      keys: [`${metricSource.resourceAttributesExpression}['${fieldName}']`],
      disableRowLimit: true,
      limit: 1000000,
    },
    // Lazy mode only fetches once the dropdown has been opened.
    { enabled: lazy ? opened : true },
  );

  const options = useMemo(() => {
    const opts =
      data?.[0]?.value
        .map(v => ({ value: v, label: v }))
        .sort((a, b) => a.value.localeCompare(b.value)) || []; // Sort alphabetically for better search results
    // Keep the current selection visible even before this dropdown's values
    // have been fetched (lazy mode), where it wouldn't yet be in `data`.
    if (value && !opts.some(o => o.value === value)) {
      opts.unshift({ value, label: value });
    }
    return opts;
  }, [data, value]);

  return (
    <Select
      placeholder={placeholder + (isLoading ? ' (loading...)' : '')}
      data={options}
      value={value}
      onChange={onChange}
      onDropdownOpen={() => setOpened(true)}
      onDropdownClose={() => setOpened(false)}
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
      const resourceAttr = metricSource.resourceAttributesExpression;

      setPodName(
        extractValueFromSearchQuery(searchQuery, resourceAttr, 'k8s.pod.name'),
      );
      setDeploymentName(
        extractValueFromSearchQuery(
          searchQuery,
          resourceAttr,
          'k8s.deployment.name',
        ),
      );
      setNodeName(
        extractValueFromSearchQuery(searchQuery, resourceAttr, 'k8s.node.name'),
      );
      setNamespaceName(
        extractValueFromSearchQuery(
          searchQuery,
          resourceAttr,
          'k8s.namespace.name',
        ),
      );
      setClusterName(
        extractValueFromSearchQuery(
          searchQuery,
          resourceAttr,
          'k8s.cluster.name',
        ),
      );
    }
  }, [searchQuery, metricSource.resourceAttributesExpression]);

  // Build a chart config for fetching each field's selectable values. Memoized so
  // the config objects keep a stable identity across re-renders unrelated to the
  // filters (each is spread into useGetKeyValues' React Query key).
  // Faceted filtering: constrain a field's values by every OTHER active K8s filter
  // and the free-text search (i.e. the whole searchQuery except this field's own
  // clause), so e.g. picking a cluster narrows the namespace list.
  const chartConfigs = useMemo(() => {
    const build = (field: string): BuilderChartConfigWithDateRange => ({
      from: {
        databaseName: metricSource.from.databaseName,
        tableName: metricSource.metricTables?.gauge || '',
      },
      // Only constrain by the other selections when linked; otherwise each
      // dropdown lists all values independently (no `where`).
      where: linked
        ? stripFieldClause(
            searchQuery,
            metricSource.resourceAttributesExpression,
            field,
          )
        : '',
      whereLanguage: 'lucene',
      select: '',
      timestampValueExpression: metricSource.timestampValueExpression || '',
      connection: metricSource.connection,
      dateRange,
    });
    return {
      'k8s.pod.name': build('k8s.pod.name'),
      'k8s.deployment.name': build('k8s.deployment.name'),
      'k8s.node.name': build('k8s.node.name'),
      'k8s.namespace.name': build('k8s.namespace.name'),
      'k8s.cluster.name': build('k8s.cluster.name'),
    };
  }, [searchQuery, dateRange, metricSource, linked]);

  // Helper function to update search query
  const updateSearchQuery = (
    attribute: string,
    value: string | null,
    setter: (value: string | null) => void,
  ) => {
    setter(value);

    const resourceAttr = metricSource.resourceAttributesExpression;
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
      <FilterSelect
        metricSource={metricSource}
        placeholder="Pod"
        fieldName="k8s.pod.name"
        value={podName}
        onChange={value => updateSearchQuery('k8s.pod.name', value, setPodName)}
        chartConfig={chartConfigs['k8s.pod.name']}
        lazy={linked}
        dataTestId="pod-filter-select"
      />

      <FilterSelect
        metricSource={metricSource}
        placeholder="Deployment"
        fieldName="k8s.deployment.name"
        value={deploymentName}
        onChange={value =>
          updateSearchQuery('k8s.deployment.name', value, setDeploymentName)
        }
        chartConfig={chartConfigs['k8s.deployment.name']}
        lazy={linked}
        dataTestId="deployment-filter-select"
      />

      <FilterSelect
        metricSource={metricSource}
        placeholder="Node"
        fieldName="k8s.node.name"
        value={nodeName}
        onChange={value =>
          updateSearchQuery('k8s.node.name', value, setNodeName)
        }
        chartConfig={chartConfigs['k8s.node.name']}
        lazy={linked}
        dataTestId="node-filter-select"
      />

      <FilterSelect
        metricSource={metricSource}
        placeholder="Namespace"
        fieldName="k8s.namespace.name"
        value={namespaceName}
        onChange={value =>
          updateSearchQuery('k8s.namespace.name', value, setNamespaceName)
        }
        chartConfig={chartConfigs['k8s.namespace.name']}
        lazy={linked}
        dataTestId="namespace-filter-select"
      />

      <FilterSelect
        metricSource={metricSource}
        placeholder="Cluster"
        fieldName="k8s.cluster.name"
        value={clusterName}
        onChange={value =>
          updateSearchQuery('k8s.cluster.name', value, setClusterName)
        }
        chartConfig={chartConfigs['k8s.cluster.name']}
        lazy={linked}
        dataTestId="cluster-filter-select"
      />
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
