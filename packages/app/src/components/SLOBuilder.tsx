import React, { useState } from 'react';
import {
  Stack,
  Select,
  Group,
  Button,
  Text,
  Divider,
  NumberInput,
  Paper,
  Badge,
  Alert,
  Code,
  Accordion,
  MultiSelect,
  SegmentedControl,
  TextInput,
} from '@mantine/core';
import { IconInfoCircle, IconSparkles } from '@tabler/icons-react';

interface SLOBuilderProps {
  metricType: string;
  sourceTable: string;
  onGenerate: (filter: string, goodCondition: string) => void;
}

interface Condition {
  field: string;
  operator: string;
  value: string;
}

const LOGS_FIELDS = [
  { value: 'ServiceName', label: 'Service Name', type: 'string' },
  { value: 'SeverityNumber', label: 'Severity Number', type: 'number', description: '0-24, where <17 is non-error' },
  { value: 'SeverityText', label: 'Severity Text', type: 'string', description: 'INFO, WARN, ERROR, etc.' },
  { value: 'Body', label: 'Log Body', type: 'string' },
];

const TRACES_FIELDS = [
  { value: 'ServiceName', label: 'Service Name', type: 'string' },
  { value: 'SpanName', label: 'Span Name', type: 'string', description: 'e.g., POST /api/checkout' },
  { value: 'StatusCode', label: 'Status Code', type: 'string', description: 'Ok, Error' },
  { value: 'Duration', label: 'Duration (ms)', type: 'number' },
  { value: 'SpanKind', label: 'Span Kind', type: 'string', description: 'Server, Client, etc.' },
];

const STRING_OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: 'LIKE', label: 'contains' },
  { value: 'NOT LIKE', label: 'does not contain' },
];

const NUMBER_OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: '<', label: 'less than' },
  { value: '<=', label: 'less than or equal' },
  { value: '>', label: 'greater than' },
  { value: '>=', label: 'greater than or equal' },
];

const SLO_TEMPLATES = {
  logs: {
    availability: {
      name: 'Log Error Rate',
      description: '99.9% of logs should be non-errors',
      filter: "ServiceName = '{service}'",
      goodCondition: 'SeverityNumber < 17',
    },
    error_rate: {
      name: 'Error Log Percentage',
      description: 'Less than 0.1% error logs',
      filter: "ServiceName = '{service}'",
      goodCondition: 'SeverityNumber < 17',
    },
  },
  traces: {
    latency: {
      name: 'P99 Latency',
      description: '99% of requests complete within target latency',
      filter: "ServiceName = '{service}' AND SpanKind = 'Server'",
      goodCondition: "StatusCode = 'Ok' AND Duration < {latency_ms}",
    },
    availability: {
      name: 'Request Success Rate',
      description: '99.5% of requests succeed',
      filter: "ServiceName = '{service}' AND SpanKind = 'Server'",
      goodCondition: "StatusCode = 'Ok'",
    },
    error_rate: {
      name: 'Request Error Rate',
      description: 'Less than 0.5% failed requests',
      filter: "ServiceName = '{service}' AND SpanKind = 'Server'",
      goodCondition: "StatusCode = 'Ok'",
    },
  },
};

export default function SLOBuilder({
  metricType,
  sourceTable,
  onGenerate,
}: SLOBuilderProps) {
  const isTraces = sourceTable === 'otel_traces';
  const fields = isTraces ? TRACES_FIELDS : LOGS_FIELDS;

  // Builder state
  const [baseConditions, setBaseConditions] = useState<Condition[]>([
    { field: 'ServiceName', operator: '=', value: '' },
  ]);
  const [successConditions, setSuccessConditions] = useState<Condition[]>([]);
  
  // Template state
  const [serviceName, setServiceName] = useState('');
  const [latencyTarget, setLatencyTarget] = useState(200);
  const [useTemplate, setUseTemplate] = useState(true);

  const addBaseCondition = () => {
    setBaseConditions([
      ...baseConditions,
      { field: fields[0].value, operator: '=', value: '' },
    ]);
  };

  const removeBaseCondition = (index: number) => {
    setBaseConditions(baseConditions.filter((_, i) => i !== index));
  };

  const updateBaseCondition = (index: number, updates: Partial<Condition>) => {
    const updated = [...baseConditions];
    updated[index] = { ...updated[index], ...updates };
    setBaseConditions(updated);
  };

  const addSuccessCondition = () => {
    setSuccessConditions([
      ...successConditions,
      { field: fields[0].value, operator: '=', value: '' },
    ]);
  };

  const removeSuccessCondition = (index: number) => {
    setSuccessConditions(successConditions.filter((_, i) => i !== index));
  };

  const updateSuccessCondition = (index: number, updates: Partial<Condition>) => {
    const updated = [...successConditions];
    updated[index] = { ...updated[index], ...updates };
    setSuccessConditions(updated);
  };

  const buildSQL = (conditions: Condition[]) => {
    return conditions
      .filter((c) => c.value !== '')
      .map((c) => {
        const field = fields.find((f) => f.value === c.field);
        const isString = field?.type === 'string';
        const needsQuotes = isString && !c.operator.includes('LIKE');
        const needsPercent = c.operator.includes('LIKE');

        let value = c.value;
        if (needsPercent && !value.includes('%')) {
          value = `%${value}%`;
        }
        if (needsQuotes || needsPercent) {
          value = `'${value.replace(/'/g, "\\'")}'`;
        }

        return `${c.field} ${c.operator} ${value}`;
      })
      .join(' AND ');
  };

  const handleApplyTemplate = () => {
    const templates = isTraces ? SLO_TEMPLATES.traces : SLO_TEMPLATES.logs;
    const template = templates[metricType as keyof typeof templates];
    
    if (!template) return;

    let filter = template.filter.replace('{service}', serviceName || 'my-service');
    let goodCondition = template.goodCondition;
    
    if (metricType === 'latency' && isTraces) {
      goodCondition = goodCondition.replace('{latency_ms}', String(latencyTarget));
    }

    onGenerate(filter, goodCondition);
  };

  const handleBuildFromConditions = () => {
    const filter = buildSQL(baseConditions);
    const goodCondition = buildSQL(successConditions);
    onGenerate(filter, goodCondition);
  };

  const getOperators = (fieldName: string) => {
    const field = fields.find((f) => f.value === fieldName);
    return field?.type === 'number' ? NUMBER_OPERATORS : STRING_OPERATORS;
  };

  const renderConditionBuilder = (
    conditions: Condition[],
    onChange: (index: number, updates: Partial<Condition>) => void,
    onRemove: (index: number) => void,
    onAdd: () => void,
    title: string,
  ) => (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        {title}
      </Text>
      {conditions.map((condition, index) => {
        const field = fields.find((f) => f.value === condition.field);
        return (
          <Group key={index} gap="xs" align="flex-start" wrap="nowrap">
            <Select
              data={fields.map((f) => ({
                value: f.value,
                label: f.label,
              }))}
              value={condition.field}
              onChange={(value) => onChange(index, { field: value || '' })}
              style={{ flex: 1 }}
              searchable
            />
            <Select
              data={getOperators(condition.field)}
              value={condition.operator}
              onChange={(value) => onChange(index, { operator: value || '=' })}
              style={{ width: 150 }}
            />
            <TextInput
              value={condition.value}
              onChange={(e) => onChange(index, { value: e.target.value })}
              placeholder={
                field?.type === 'number' ? 'e.g., 200' : "e.g., 'my-service'"
              }
              style={{ flex: 1 }}
            />
            {conditions.length > 1 && (
              <Button
                variant="subtle"
                color="red"
                onClick={() => onRemove(index)}
                size="xs"
              >
                Remove
              </Button>
            )}
          </Group>
        );
      })}
      <Button variant="light" size="xs" onClick={onAdd} style={{ width: 'fit-content' }}>
        + Add Condition
      </Button>
    </Stack>
  );

  const templates = isTraces ? SLO_TEMPLATES.traces : SLO_TEMPLATES.logs;
  const currentTemplate = templates[metricType as keyof typeof templates];

  return (
    <Stack gap="md">
      <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
        <Text size="sm">
          {isTraces
            ? 'Build SLOs based on distributed traces (spans) to measure request latency and success rates'
            : 'Build SLOs based on application logs to measure error rates and availability'}
        </Text>
      </Alert>

      <SegmentedControl
        value={useTemplate ? 'template' : 'custom'}
        onChange={(value) => setUseTemplate(value === 'template')}
        data={[
          { label: '✨ Use Template', value: 'template' },
          { label: '🔧 Custom Builder', value: 'custom' },
        ]}
        fullWidth
      />

      {useTemplate ? (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group gap="xs">
              <IconSparkles size={20} />
              <Text fw={600}>{currentTemplate?.name}</Text>
              <Badge size="sm" variant="light">
                Recommended
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              {currentTemplate?.description}
            </Text>

            <Divider />

            <TextInput
              label="Service Name"
              placeholder="e.g., checkout-service"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              required
            />

            {metricType === 'latency' && isTraces && (
              <NumberInput
                label="Latency Target (milliseconds)"
                description="Requests should complete within this time"
                placeholder="200"
                value={latencyTarget}
                onChange={(value) => setLatencyTarget(Number(value) || 200)}
                min={1}
                max={10000}
              />
            )}

            <Accordion variant="separated">
              <Accordion.Item value="preview">
                <Accordion.Control>
                  <Text size="sm" fw={500}>
                    📋 Preview Generated SQL
                  </Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    <div>
                      <Text size="xs" c="dimmed" mb={4}>
                        Base Filter (all eligible events):
                      </Text>
                      <Code block>
                        {currentTemplate?.filter.replace(
                          '{service}',
                          serviceName || 'my-service',
                        )}
                      </Code>
                    </div>
                    <div>
                      <Text size="xs" c="dimmed" mb={4}>
                        Good Event Condition (successful events):
                      </Text>
                      <Code block>
                        {currentTemplate?.goodCondition.replace(
                          '{latency_ms}',
                          String(latencyTarget),
                        )}
                      </Code>
                    </div>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>

            <Button onClick={handleApplyTemplate} disabled={!serviceName}>
              Apply Template
            </Button>
          </Stack>
        </Paper>
      ) : (
        <Paper p="md" withBorder>
          <Stack gap="lg">
            {renderConditionBuilder(
              baseConditions,
              updateBaseCondition,
              removeBaseCondition,
              addBaseCondition,
              '1. Define Base Filter (Which events to measure?)',
            )}

            <Divider />

            {renderConditionBuilder(
              successConditions,
              updateSuccessCondition,
              removeSuccessCondition,
              addSuccessCondition,
              '2. Define Success Criteria (What makes an event "good"?)',
            )}

            <Divider />

            <div>
              <Text size="sm" fw={600} mb="xs">
                Generated SQL Preview:
              </Text>
              <Stack gap="xs">
                <div>
                  <Text size="xs" c="dimmed">
                    Base Filter:
                  </Text>
                  <Code block>{buildSQL(baseConditions) || '(empty)'}</Code>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Good Condition:
                  </Text>
                  <Code block>
                    {buildSQL(successConditions) || '(empty)'}
                  </Code>
                </div>
              </Stack>
            </div>

            <Button
              onClick={handleBuildFromConditions}
              disabled={
                buildSQL(baseConditions) === '' ||
                buildSQL(successConditions) === ''
              }
            >
              Apply Custom Conditions
            </Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

