import { expect, test, type TestBody } from 'claude-code/testing';

// The bundled MCP server's settings must be set for the hooks module to load.
const options = { hyperdx_url: 'https://hyperdx.test', access_key: 'test-key' };

type Engine = Parameters<TestBody>[0];
type On = Parameters<TestBody>[1];

const TIMESERIES = 'mcp__clickstack__clickstack_timeseries';
const TABLE = 'mcp__clickstack__clickstack_table';

const timeseries = {
  meta: [
    { name: 'Error %', type: 'Float64' },
    { name: 'ServiceName', type: 'LowCardinality(String)' },
    { name: '__hdx_time_bucket', type: 'DateTime' },
  ],
  data: ['api', 'worker'].flatMap((service, s) =>
    [0, 5, 10, 15].map(m => ({
      'Error %': (s + 1) * (m + 1),
      ServiceName: service,
      __hdx_time_bucket: `2026-10-13T00:${String(m).padStart(2, '0')}:00Z`,
    })),
  ),
};

const table = {
  meta: [
    { name: 'Errors', type: 'UInt64' },
    { name: 'ServiceName', type: 'LowCardinality(String)' },
  ],
  data: [
    { Errors: '42', ServiceName: 'api' },
    { Errors: '7', ServiceName: 'worker' },
  ],
};

async function drawCall(
  $: Engine,
  on: On,
  tool: `mcp__${string}__${string}`,
  input: Record<string, unknown>,
  result: unknown,
) {
  let id = '';
  on('tool.call', (_, e) => {
    id = e.tool_use_id;
    return { result: [{ type: 'text', text: JSON.stringify({ result }) }] };
  });
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  await $.tool.call({
    tool,
    sourceId: 's',
    select: [{ aggFn: 'count' }],
    ...input,
  });
  return $.ui.mount({
    plugin: 'hyperdx-charts',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [
        {
          tool_use_id: id,
          tool,
          input: { reason: 'Checking errors', ...input },
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: 100, rows: 40 },
  });
}

test(
  'draws a timeseries call as a line chart in place of its row',
  { options },
  async ($, on) => {
    const ui = await drawCall(
      $,
      on,
      TIMESERIES,
      {
        startTime: '2026-10-13T00:00:00Z',
        endTime: '2026-10-13T00:20:00Z',
        granularity: '5 minute',
      },
      timeseries,
    );
    expect(
      await ui.find({ type: 'Text', text: /^engine row$/ }),
    ).toBeUndefined();
    expect(
      await ui.find({ type: 'Text', text: /Checking errors/ }),
    ).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /worker/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /[┤┼╭╮╰╯─]/ })).toBeDefined();
  },
);

test(
  'draws a table call with bar shape as categorical bars',
  { options },
  async ($, on) => {
    const ui = await drawCall($, on, TABLE, { shape: 'bar' }, table);
    expect(await ui.find({ type: 'Text', text: /api/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined();
  },
);

test(
  'keeps the engine row for a result it cannot chart',
  { options },
  async ($, on) => {
    const ui = await drawCall(
      $,
      on,
      TIMESERIES,
      {},
      { meta: [{ name: 'x', type: 'String' }], data: [{ x: 'a' }] },
    );
    expect(await ui.find({ type: 'Text', text: /^engine row$/ })).toBeDefined();
  },
);

test(
  'draws a timeseries call drawn as its own tool row',
  { options },
  async ($, on) => {
    let id = '';
    on('tool.call', (_, e) => {
      id = e.tool_use_id;
      return {
        result: [
          { type: 'text', text: JSON.stringify({ result: timeseries }) },
        ],
      };
    });
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e);
      return <Text>engine row</Text>;
    });
    const input = {
      startTime: '2026-10-13T00:00:00Z',
      endTime: '2026-10-13T00:20:00Z',
      granularity: '5 minute',
    };
    await $.tool.call({
      tool: TIMESERIES,
      sourceId: 's',
      select: [{ aggFn: 'count' }],
      ...input,
    });
    const ui = await $.ui.mount({
      plugin: 'hyperdx-charts',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: id,
      props: {
        tool_use_id: id,
        tool: TIMESERIES,
        input,
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
      viewport: { columns: 100, rows: 40 },
    });
    expect(
      await ui.find({ type: 'Text', text: /^engine row$/ }),
    ).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /[┤┼╭╮╰╯─]/ })).toBeDefined();
  },
);
