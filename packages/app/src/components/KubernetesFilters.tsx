import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  ChartConfigWithDateRange,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Group, Select } from '@mantine/core';

import { useGetKeyValues } from '@/hooks/useMetadata';
import SearchInputV2 from '@/SearchInputV2';

type KubernetesFiltersProps = {
  dateRange: [Date, Date];
  metricSource: TSource;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

type FilterSelectProps = {
  metricSource: TSource;
  placeholder: string;
  fieldName: string;
  value: string | null;
  onChange: (value: string | null) => void;
  chartConfig: ChartConfigWithDateRange;
  dataTestId?: string;
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

  const options =
    data?.[0]?.value
      .map(value => ({ value, label: value }))
      .sort((a, b) => a.value.localeCompare(b.value)) || []; // Sort alphabetically for better search results

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

  const { control, watch, setValue } = useForm({
    defaultValues: {
      searchQuery: searchQuery,
    },
  });

  // Watch for changes in the search query field
  useEffect(() => {
    const subscription = watch((value, { name }) => {
      if (name === 'searchQuery') {
        setSearchQuery(value.searchQuery ?? '');
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, setSearchQuery]);

  // Update search form value when search query changes
  useEffect(() => {
    setValue('searchQuery', searchQuery);
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

  // Create chart config for fetching key values
  const chartConfig: ChartConfigWithDateRange = {
    from: {
      databaseName: metricSource.from.databaseName,
      tableName: metricSource.metricTables?.gauge || '',
    },
    where: '',
    whereLanguage: 'sql',
    select: '',
    timestampValueExpression: metricSource.timestampValueExpression || '',
    connection: metricSource.connection,
    dateRange,
  };

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
    let newQuery = searchQuery;
    const regex = new RegExp(`${fullAttribute}:"[^"]*"`, 'g');
    newQuery = newQuery.replace(regex, '').trim();

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
        chartConfig={chartConfig}
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
        chartConfig={chartConfig}
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
        chartConfig={chartConfig}
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
        chartConfig={chartConfig}
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
        chartConfig={chartConfig}
        dataTestId="cluster-filter-select"
      />
      <SearchInputV2
        tableConnection={tcFromSource(metricSource)}
        placeholder="Search query"
        language="lucene"
        name="searchQuery"
        control={control}
        size="xs"
        enableHotkey
        data-testid="k8s-search-input"
      />
    </Group>
  );
};
