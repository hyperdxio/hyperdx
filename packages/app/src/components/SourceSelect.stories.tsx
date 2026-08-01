import { http, HttpResponse } from 'msw';
import { useForm } from 'react-hook-form';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { Box } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { SourceSelectControlled } from './SourceSelect';

const mockSources = [
  {
    id: 'source-logs',
    name: 'OpenAPI LB Logs New',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-console-logs',
    name: 'Console API LB Logs New',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'console_logs' },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-traces',
    name: 'Data Plane Traces',
    kind: SourceKind.Trace,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-sessions',
    name: 'Sessions',
    kind: SourceKind.Session,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'hyperdx_sessions' },
    timestampValueExpression: 'Timestamp',
  },
  {
    id: 'source-metrics',
    name: 'System Metrics',
    kind: SourceKind.Metric,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: 'otel_metrics' },
    timestampValueExpression: 'TimeUnix',
  },
];

const sourcesHandler = http.get('*/api/sources', () =>
  HttpResponse.json(mockSources),
);

/**
 * `SourceSelectControlled` is the data-source picker used across the search,
 * chart, and dashboard surfaces. It is a `react-hook-form`-controlled Mantine
 * `Select` that lists the team's sources (optionally grouped by section), shows
 * the selected source's signal-kind icon on the left, and can render an
 * adjacent kebab menu for source-management actions.
 *
 * The dropdown marks the currently selected source with a trailing check so it
 * is easy to tell which source is active while scanning the list.
 */
const meta: Meta<typeof SourceSelectControlled> = {
  title: 'Components/SourceSelect',
  component: SourceSelectControlled,
  parameters: {
    layout: 'padded',
    msw: { handlers: { sources: sourcesHandler } },
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Mantine input size',
    },
  },
};

export default meta;

type StoryArgs = {
  size?: string;
  defaultSourceId?: string;
  withMenu?: boolean;
  allowedSourceKinds?: SourceKind[];
};

const SourceSelectWrapper = ({
  size,
  defaultSourceId = 'source-logs',
  withMenu,
  allowedSourceKinds,
}: StoryArgs) => {
  const { control } = useForm<{ source: string }>({
    defaultValues: { source: defaultSourceId },
  });

  return (
    <Box style={{ maxWidth: 420 }}>
      <SourceSelectControlled
        control={control}
        name="source"
        size={size}
        allowedSourceKinds={allowedSourceKinds}
        onSchemaPreview={withMenu ? () => {} : undefined}
        onEdit={withMenu ? () => {} : undefined}
        onManageSources={withMenu ? () => {} : undefined}
        onCreate={withMenu ? () => {} : undefined}
      />
    </Box>
  );
};

type Story = StoryObj<typeof SourceSelectWrapper>;

/**
 * A source is pre-selected. Open the dropdown to see the active source marked
 * with a check, alongside each source's signal-kind icon.
 */
export const Default: Story = {
  render: args => <SourceSelectWrapper {...args} />,
  args: {
    size: 'sm',
    defaultSourceId: 'source-logs',
  },
};

/** With the adjacent source-management kebab menu (view schema, edit, etc.). */
export const WithManagementMenu: Story = {
  name: 'With Management Menu',
  render: args => <SourceSelectWrapper {...args} />,
  args: {
    size: 'sm',
    defaultSourceId: 'source-traces',
    withMenu: true,
  },
};

/** No source selected yet — shows the generic placeholder icon and text. */
export const NoSelection: Story = {
  name: 'No Selection (Placeholder)',
  render: args => <SourceSelectWrapper {...args} />,
  args: {
    size: 'sm',
    defaultSourceId: '',
  },
};

/** Restricted to a single signal kind via `allowedSourceKinds`. */
export const LogsOnly: Story = {
  name: 'Logs Only',
  render: args => <SourceSelectWrapper {...args} />,
  args: {
    size: 'sm',
    defaultSourceId: 'source-logs',
    allowedSourceKinds: [SourceKind.Log],
  },
};
