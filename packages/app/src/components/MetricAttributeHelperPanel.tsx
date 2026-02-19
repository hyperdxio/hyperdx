import { useCallback, useMemo, useState } from 'react';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Box,
  Button,
  Collapse,
  Flex,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconPlus,
  IconSearch,
} from '@tabler/icons-react';

import { useFetchMetricAttributeValues } from '@/hooks/useFetchMetricAttributeValues';
import { MetricMetadata } from '@/hooks/useFetchMetricMetadata';
import {
  AttributeCategory,
  AttributeKey,
} from '@/hooks/useFetchMetricResourceAttrs';

interface MetricAttributeHelperPanelProps {
  databaseName: string;
  metricType: string;
  metricName: string;
  tableSource: TSource | undefined;
  attributeKeys: AttributeKey[];
  isLoading?: boolean;
  language: 'sql' | 'lucene';
  metricMetadata?: MetricMetadata | null;
  onAddToWhere: (clause: string) => void;
  onAddToGroupBy: (clause: string) => void;
}

const CATEGORY_LABELS: Record<AttributeCategory, string> = {
  ResourceAttributes: 'Resource',
  Attributes: 'Attributes',
  ScopeAttributes: 'Scope',
};

// UCUM (Unified Code for Units of Measure) case-sensitive codes to human-readable names
// Reference: https://ucum.org/ucum
const UCUM_UNIT_NAMES: Record<string, string> = {
  // Time units
  s: 'Seconds',
  ms: 'Milliseconds',
  us: 'Microseconds',
  ns: 'Nanoseconds',
  min: 'Minutes',
  h: 'Hours',
  d: 'Days',
  wk: 'Weeks',
  mo: 'Months',
  a: 'Years',
  // Data units
  By: 'Bytes',
  KiBy: 'Kibibytes',
  MiBy: 'Mebibytes',
  GiBy: 'Gibibytes',
  TiBy: 'Tebibytes',
  kBy: 'Kilobytes',
  MBy: 'Megabytes',
  GBy: 'Gigabytes',
  TBy: 'Terabytes',
  bit: 'Bits',
  Kibit: 'Kibibits',
  Mibit: 'Mebibits',
  Gibit: 'Gibibits',
  // Frequency
  Hz: 'Hertz',
  kHz: 'Kilohertz',
  MHz: 'Megahertz',
  GHz: 'Gigahertz',
  // Temperature
  Cel: 'Celsius',
  K: 'Kelvin',
  '[degF]': 'Fahrenheit',
  // Percentage and dimensionless
  '%': 'Percent',
  '1': 'Count',
  '{request}': 'Requests',
  '{connection}': 'Connections',
  '{error}': 'Errors',
  '{packet}': 'Packets',
  '{thread}': 'Threads',
  '{process}': 'Processes',
  '{message}': 'Messages',
  '{operation}': 'Operations',
  '{call}': 'Calls',
  '{fault}': 'Faults',
  '{cpu}': 'CPUs',
  // Physical units
  m: 'Meters',
  km: 'Kilometers',
  g: 'Grams',
  kg: 'Kilograms',
  A: 'Amperes',
  V: 'Volts',
  W: 'Watts',
  kW: 'Kilowatts',
  J: 'Joules',
  kJ: 'Kilojoules',
};

// Format UCUM unit code to human-readable name
function formatUnitDisplay(unit: string): string {
  // Direct match
  if (UCUM_UNIT_NAMES[unit]) {
    return UCUM_UNIT_NAMES[unit];
  }

  // Handle compound units like "By/s" -> "Bytes/Second"
  if (unit.includes('/')) {
    const [numerator, denominator] = unit.split('/');
    const numName = UCUM_UNIT_NAMES[numerator] || numerator;
    const denomName = UCUM_UNIT_NAMES[denominator] || denominator;
    // Singularize denominator (remove trailing 's' if present)
    const singularDenom = denomName.endsWith('s')
      ? denomName.slice(0, -1)
      : denomName;
    return `${numName}/${singularDenom}`;
  }

  // Return original if no mapping found
  return unit;
}

function formatWhereClause(
  category: AttributeCategory,
  name: string,
  value: string,
  language: 'sql' | 'lucene',
): string {
  if (language === 'sql') {
    return `${category}['${name}'] = '${value}'`;
  }
  return `${category}.${name}:"${value}"`;
}

function formatGroupByClause(
  category: AttributeCategory,
  name: string,
  language: 'sql' | 'lucene',
): string {
  if (language === 'sql') {
    return `${category}['${name}']`;
  }
  return `${category}.${name}`;
}

interface AttributeValueListProps {
  databaseName: string;
  metricType: string;
  metricName: string;
  tableSource: TSource | undefined;
  attribute: AttributeKey;
  language: 'sql' | 'lucene';
  onAddToWhere: (clause: string) => void;
  onBack: () => void;
  onAddToGroupBy: (clause: string) => void;
}

function AttributeValueList({
  databaseName,
  metricType,
  metricName,
  tableSource,
  attribute,
  language,
  onAddToWhere,
  onBack,
  onAddToGroupBy,
}: AttributeValueListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch] = useDebouncedValue(searchTerm, 300);

  const { data: values, isLoading } = useFetchMetricAttributeValues({
    databaseName,
    metricType,
    metricName,
    attributeName: attribute.name,
    attributeCategory: attribute.category,
    searchTerm: debouncedSearch,
    tableSource,
  });

  const handleAddValueToWhere = useCallback(
    (value: string) => {
      const clause = formatWhereClause(
        attribute.category,
        attribute.name,
        value,
        language,
      );
      onAddToWhere(clause);
    },
    [attribute, language, onAddToWhere],
  );

  const handleAddToGroupBy = useCallback(() => {
    // Group By is always SQL syntax, regardless of Where condition language
    const clause = formatGroupByClause(
      attribute.category,
      attribute.name,
      'sql',
    );
    onAddToGroupBy(clause);
  }, [attribute, onAddToGroupBy]);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <UnstyledButton onClick={onBack}>
          <Group gap={4}>
            <IconChevronLeft size={16} />
            <Text size="sm" fw={500}>
              {attribute.name}
            </Text>
            <Badge size="xs" variant="default">
              {CATEGORY_LABELS[attribute.category]}
            </Badge>
          </Group>
        </UnstyledButton>
        <Button
          variant="secondary"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={handleAddToGroupBy}
        >
          Group By
        </Button>
      </Group>

      <TextInput
        size="xs"
        placeholder="Search values..."
        leftSection={<IconSearch size={14} />}
        value={searchTerm}
        onChange={e => setSearchTerm(e.currentTarget.value)}
      />

      {isLoading ? (
        <Flex justify="center" py="md">
          <Loader size="sm" />
        </Flex>
      ) : values && values.length > 0 ? (
        <ScrollArea.Autosize mah={200}>
          <Stack gap={4}>
            {values.map(value => (
              <Group
                key={value}
                justify="space-between"
                py={4}
                px="xs"
                style={{
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                className="hover-highlight"
              >
                <Text size="xs" style={{ wordBreak: 'break-all' }}>
                  {value}
                </Text>
                <Button
                  variant="secondary"
                  size="compact-xs"
                  leftSection={<IconFilter size={12} />}
                  onClick={() => handleAddValueToWhere(value)}
                >
                  Where
                </Button>
              </Group>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      ) : (
        <Text size="xs" c="dimmed" ta="center" py="md">
          {searchTerm ? 'No matching values found' : 'No values found'}
        </Text>
      )}
    </Stack>
  );
}

interface AttributeListProps {
  attributeKeys: AttributeKey[];
  onSelectAttribute: (attr: AttributeKey) => void;
}

function AttributeList({
  attributeKeys,
  onSelectAttribute,
}: AttributeListProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAttributes = useMemo(() => {
    if (!searchTerm) return attributeKeys;
    const lower = searchTerm.toLowerCase();
    return attributeKeys.filter(attr =>
      attr.name.toLowerCase().includes(lower),
    );
  }, [attributeKeys, searchTerm]);

  const groupedAttributes = useMemo(() => {
    const groups: Record<AttributeCategory, AttributeKey[]> = {
      ResourceAttributes: [],
      Attributes: [],
      ScopeAttributes: [],
    };
    for (const attr of filteredAttributes) {
      groups[attr.category].push(attr);
    }
    return groups;
  }, [filteredAttributes]);

  const categories: AttributeCategory[] = [
    'ResourceAttributes',
    'Attributes',
    'ScopeAttributes',
  ];

  return (
    <Stack gap="xs">
      <TextInput
        size="xs"
        placeholder="Search attributes..."
        leftSection={<IconSearch size={14} />}
        value={searchTerm}
        onChange={e => setSearchTerm(e.currentTarget.value)}
      />

      <ScrollArea.Autosize mah={250}>
        <Stack gap="sm">
          {categories.map(category => {
            const attrs = groupedAttributes[category];
            if (attrs.length === 0) return null;

            return (
              <Box key={category}>
                <Group gap="xs" mb={4}>
                  <Text size="xs" fw={600} c="dimmed">
                    {CATEGORY_LABELS[category]}
                  </Text>
                  <Badge size="xs" variant="default">
                    {attrs.length}
                  </Badge>
                </Group>
                <Flex gap={6} wrap="wrap">
                  {attrs.map(attr => (
                    <UnstyledButton
                      key={`${attr.category}:${attr.name}`}
                      onClick={() => onSelectAttribute(attr)}
                    >
                      <Paper
                        py={4}
                        px={8}
                        withBorder
                        style={{ cursor: 'pointer' }}
                        className="hover-highlight"
                      >
                        <Group gap={4}>
                          <Text size="xs">{attr.name}</Text>
                          <IconChevronRight size={12} />
                        </Group>
                      </Paper>
                    </UnstyledButton>
                  ))}
                </Flex>
              </Box>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

export function MetricAttributeHelperPanel({
  databaseName,
  metricName,
  tableSource,
  metricType,
  attributeKeys,
  isLoading,
  language,
  metricMetadata,
  onAddToWhere,
  onAddToGroupBy,
}: MetricAttributeHelperPanelProps) {
  const [opened, { toggle }] = useDisclosure(false);
  const [selectedAttribute, setSelectedAttribute] =
    useState<AttributeKey | null>(null);

  const handleSelectAttribute = useCallback((attr: AttributeKey) => {
    setSelectedAttribute(attr);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedAttribute(null);
  }, []);

  if (!metricName) {
    return null;
  }

  return (
    <Paper withBorder p="xs" mt="xs">
      <UnstyledButton onClick={toggle} w="100%">
        <Group justify="space-between" wrap="nowrap">
          <Box style={{ flex: 1, minWidth: 0 }}>
            {metricMetadata?.description ? (
              <Text size="xs" c="dimmed" truncate>
                {metricMetadata.description}
              </Text>
            ) : (
              <Text size="xs" c="dimmed">
                {metricName}
              </Text>
            )}
            {metricMetadata?.unit && (
              <Group gap={4} mt={2}>
                <Text size="xs" c="dimmed">
                  Unit:
                </Text>
                <Badge size="xs" variant="light">
                  {formatUnitDisplay(metricMetadata.unit)}
                </Badge>
              </Group>
            )}
          </Box>
          <Group gap="xs" wrap="nowrap">
            {attributeKeys.length > 0 && (
              <Badge size="xs" variant="light">
                {attributeKeys.length} attributes
              </Badge>
            )}
            <IconChevronDown
              size={16}
              style={{
                transform: opened ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 200ms',
              }}
            />
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={opened}>
        <Box pt="xs">
          {isLoading ? (
            <Flex justify="center" py="md">
              <Loader size="sm" />
            </Flex>
          ) : attributeKeys.length === 0 ? (
            <Text size="xs" c="dimmed" ta="center" py="md">
              No attributes found for this metric
            </Text>
          ) : selectedAttribute ? (
            <AttributeValueList
              databaseName={databaseName}
              metricType={metricType}
              metricName={metricName}
              tableSource={tableSource}
              attribute={selectedAttribute}
              language={language}
              onAddToWhere={onAddToWhere}
              onBack={handleBack}
              onAddToGroupBy={onAddToGroupBy}
            />
          ) : (
            <AttributeList
              attributeKeys={attributeKeys}
              onSelectAttribute={handleSelectAttribute}
            />
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
