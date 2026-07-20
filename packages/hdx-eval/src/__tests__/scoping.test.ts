import {
  decideRequest,
  extractToolResultText,
  rewriteListSourcesText,
  rewriteToolResponsePayload,
} from '@/harness/scoping';
import type { McpScoping } from '@/harness/types';

const SCOPING: McpScoping = {
  hideSourceKinds: ['metric'],
  pinSqlConnectionId: 'conn-restricted',
};

const HIDDEN = new Set(['src-metric-1']);

function toolCall(
  name: string,
  args: Record<string, unknown>,
  id: number = 7,
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

describe('decideRequest', () => {
  it('forwards non-tool-call traffic untouched', () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(decideRequest(SCOPING, HIDDEN, body)).toEqual({
      action: 'forward',
      body,
      rewriteListSources: false,
    });
  });

  it('forwards non-JSON bodies untouched', () => {
    expect(decideRequest(SCOPING, HIDDEN, 'not json')).toEqual({
      action: 'forward',
      body: 'not json',
      rewriteListSources: false,
    });
  });

  it('rejects tool calls whose sourceId is hidden, mimicking a not-found error', () => {
    const decision = decideRequest(
      SCOPING,
      HIDDEN,
      toolCall('mcp__hdx-nometrics__clickstack_timeseries', {
        sourceId: 'src-metric-1',
      }),
    );
    expect(decision.action).toBe('reject');
    if (decision.action !== 'reject') throw new Error('unreachable');
    expect(decision.response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: expect.objectContaining({ isError: true }),
    });
    expect(JSON.stringify(decision.response)).toContain(
      'Source not found: src-metric-1',
    );
  });

  it('allows tool calls with visible sourceIds', () => {
    const body = toolCall('clickstack_table', { sourceId: 'src-trace-1' });
    expect(decideRequest(SCOPING, HIDDEN, body)).toEqual({
      action: 'forward',
      body,
      rewriteListSources: false,
    });
  });

  it('pins clickstack_sql to the configured connectionId', () => {
    const decision = decideRequest(
      SCOPING,
      HIDDEN,
      toolCall('mcp__hdx-nometrics__clickstack_sql', {
        connectionId: 'conn-unrestricted',
        sql: 'SELECT 1',
      }),
    );
    expect(decision.action).toBe('forward');
    if (decision.action !== 'forward') throw new Error('unreachable');
    const parsed = JSON.parse(decision.body);
    expect(parsed.params.arguments.connectionId).toBe('conn-restricted');
    expect(parsed.params.arguments.sql).toBe('SELECT 1');
  });

  it('flags list_sources calls for response rewriting', () => {
    const body = toolCall('mcp__hdx-nometrics__clickstack_list_sources', {});
    expect(decideRequest(SCOPING, HIDDEN, body)).toEqual({
      action: 'forward',
      body,
      rewriteListSources: true,
    });
  });
});

describe('rewriteListSourcesText', () => {
  const output = {
    sources: [
      { id: 'src-trace-1', kind: 'trace', connectionId: 'conn-unrestricted' },
      { id: 'src-log-1', kind: 'log', connectionId: 'conn-unrestricted' },
      { id: 'src-metric-1', kind: 'metric', connectionId: 'conn-unrestricted' },
    ],
    connections: [
      { id: 'conn-unrestricted', name: 'hdx-eval-clickhouse' },
      { id: 'conn-restricted', name: 'hdx-eval-clickhouse-nometrics' },
    ],
    nextStep: 'Call clickstack_describe_source ...',
  };

  it('drops hidden-kind sources and reports their ids', () => {
    const { text, hiddenIds } = rewriteListSourcesText(
      SCOPING,
      JSON.stringify(output),
    );
    const rewritten = JSON.parse(text);
    expect(rewritten.sources.map((s: { id: string }) => s.id)).toEqual([
      'src-trace-1',
      'src-log-1',
    ]);
    expect(hiddenIds).toEqual(['src-metric-1']);
    expect(rewritten.nextStep).toBe(output.nextStep);
  });

  it('pins connectionIds and reduces connections to the pinned one', () => {
    const { text } = rewriteListSourcesText(SCOPING, JSON.stringify(output));
    const rewritten = JSON.parse(text);
    for (const s of rewritten.sources) {
      expect(s.connectionId).toBe('conn-restricted');
    }
    expect(rewritten.connections).toEqual([
      { id: 'conn-restricted', name: 'hdx-eval-clickhouse-nometrics' },
    ]);
  });

  it('leaves connections untouched when no pin is configured', () => {
    const { text } = rewriteListSourcesText(
      { hideSourceKinds: ['metric'] },
      JSON.stringify(output),
    );
    const rewritten = JSON.parse(text);
    expect(rewritten.connections).toHaveLength(2);
    expect(rewritten.sources[0].connectionId).toBe('conn-unrestricted');
  });

  it('passes through non-JSON payloads', () => {
    expect(rewriteListSourcesText(SCOPING, 'oops')).toEqual({
      text: 'oops',
      hiddenIds: [],
    });
  });
});

describe('rewriteToolResponsePayload', () => {
  const message = {
    jsonrpc: '2.0',
    id: 3,
    result: { content: [{ type: 'text', text: 'ORIGINAL' }] },
  };

  it('rewrites plain JSON bodies', () => {
    const rewritten = rewriteToolResponsePayload(
      JSON.stringify(message),
      'application/json',
      () => 'REWRITTEN',
    );
    expect(JSON.parse(rewritten).result.content[0].text).toBe('REWRITTEN');
  });

  it('rewrites data lines in SSE bodies, preserving other lines', () => {
    const sse = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    const rewritten = rewriteToolResponsePayload(
      sse,
      'text/event-stream',
      () => 'REWRITTEN',
    );
    expect(rewritten).toContain('event: message');
    const dataLine = rewritten.split('\n').find(l => l.startsWith('data: '))!;
    expect(JSON.parse(dataLine.slice(6)).result.content[0].text).toBe(
      'REWRITTEN',
    );
  });

  it('leaves payloads without a tool result untouched', () => {
    const notify = JSON.stringify({ jsonrpc: '2.0', method: 'ping' });
    expect(
      rewriteToolResponsePayload(notify, 'application/json', () => 'X'),
    ).toBe(notify);
  });
});

describe('extractToolResultText', () => {
  it('extracts from JSON and SSE payloads', () => {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'PAYLOAD' }] },
    });
    expect(extractToolResultText(message)).toBe('PAYLOAD');
    expect(extractToolResultText(`data: ${message}\n\n`)).toBe('PAYLOAD');
    expect(extractToolResultText('nope')).toBeNull();
  });
});
