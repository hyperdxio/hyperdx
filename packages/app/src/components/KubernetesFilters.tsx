import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  BuilderChartConfigWithDateRange,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';
import { Box, Group, Select } from '@mantine/core';

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
  const regex = new RegExp(`${fullAttribute}:"[^"]*"`, 'g');
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
}) => {
  const { data, isLoading } = useGetKeyValues({
    chartConfig,
    keys: [`${metricSource.resourceAttributesExpression}['${fieldName}']`],
    disableRowLimit: true,
    limit: 1000000,
  });

  const options = useMemo(
    () =>
      data?.[0]?.value
        .map(value => ({ value, label: value }))
        .sort((a, b) => a.value.localeCompare(b.value)) || [], // Sort alphabetically for better search results
    [data],
  );

  return (
    <Select
      placeholder={placeholder + (isLoading ? ' (loading...)' : '')}
      data={options}
      value={value}
      onChange={onChange}
      searchable
      clearable
      allowDeselect
      size="xs"
      maxDropdownHeight={280}
      disabled={isLoading}
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
    const match = searchQuery.match(
      new RegExp(`${resourceAttr}\\.${attribute}:"([^"]+)"`, 'i'),
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

  // Build a chart config for fetching a single field's selectable values.
  // Faceted filtering: constrain the values by every OTHER active K8s filter and
  // the free-text search (i.e. the whole searchQuery except this field's own
  // clause), so e.g. picking a cluster narrows the namespace list.
  const buildChartConfigForField = (
    field: string,
  ): BuilderChartConfigWithDateRange => ({
    from: {
      databaseName: metricSource.from.databaseName,
      tableName: metricSource.metricTables?.gauge || '',
    },
    where: stripFieldClause(
      searchQuery,
      metricSource.resourceAttributesExpression,
      field,
    ),
    whereLanguage: 'lucene',
    select: '',
    timestampValueExpression: metricSource.timestampValueExpression || '',
    connection: metricSource.connection,
    dateRange,
  });

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
        chartConfig={buildChartConfigForField('k8s.pod.name')}
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
        chartConfig={buildChartConfigForField('k8s.deployment.name')}
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
        chartConfig={buildChartConfigForField('k8s.node.name')}
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
        chartConfig={buildChartConfigForField('k8s.namespace.name')}
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
        chartConfig={buildChartConfigForField('k8s.cluster.name')}
        dataTestId="cluster-filter-select"
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
