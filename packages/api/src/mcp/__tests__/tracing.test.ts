// Mock OpenTelemetry and all modules that transitively import it
// These must be declared before any imports

const mockSpan = {
  setAttribute: jest.fn(),
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
};

// Any span other than the tool span, so tests can tell where an attribute
// landed.
const mockChildSpan = {
  setAttribute: jest.fn(),
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
};

const mockTracer = {
  startActiveSpan: (
    name: string,
    _optionsOrFn: unknown,
    maybeFn?: (span: typeof mockSpan) => Promise<unknown>,
  ) => {
    const fn = (
      typeof _optionsOrFn === 'function' ? _optionsOrFn : maybeFn
    ) as (span: typeof mockSpan) => Promise<unknown>;
    return fn(name.startsWith('mcp.tool.') ? mockSpan : mockChildSpan);
  },
};

const mockCounter = { add: jest.fn() };
const mockDurationHistogram = { record: jest.fn() };
const mockResponseSizeHistogram = { record: jest.fn() };
const mockMeter = {
  createCounter: jest.fn(() => mockCounter),
  createHistogram: jest.fn((name: string) =>
    name === 'hyperdx.mcp.tool.response.size_bytes'
      ? mockResponseSizeHistogram
      : mockDurationHistogram,
  ),
};

jest.mock('@opentelemetry/api', () => ({
  __esModule: true,
  default: {
    trace: {
      getTracer: () => mockTracer,
      getActiveSpan: () => mockSpan,
    },
    metrics: {
      getMeter: () => mockMeter,
    },
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
  SpanKind: {
    INTERNAL: 0,
    SERVER: 1,
    CLIENT: 2,
    PRODUCER: 3,
    CONSUMER: 4,
  },
}));

jest.mock('@hyperdx/node-opentelemetry', () => ({
  __esModule: true,
  setTraceAttributes: jest.fn(),
}));

jest.mock('@/config', () => ({
  CODE_VERSION: 'test-version',
}));

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { SourceKind } from '@hyperdx/common-utils/dist/types';

import type { McpContext } from '@/mcp/tools/types';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
import type { McpClientInfo } from '@/mcp/utils/mcpClient';
import { recordMcpSource, withToolTracing } from '@/mcp/utils/tracing';
import { withSpan } from '@/utils/instrumentation';

// Build a context whose mcpClient resolves to the given identity. The actual
// clientInfo/User-Agent resolution logic is covered in mcpClient.test.ts.
function ctx(clientInfo: McpClientInfo = {}): McpContext {
  return {
    teamId: 'team-123',
    userId: 'user-456',
    mcpClient: clientInfo,
  };
}

describe('withToolTracing', () => {
  const context = ctx();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call the handler and return its result', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });

    const traced = withToolTracing('test_tool', context, handler);
    const result = await traced({ some: 'args' });

    expect(handler).toHaveBeenCalledWith({ some: 'args' });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('should set span attributes for tool name, team, and user', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.name',
      'my_tool',
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.team.id',
      'team-123',
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.user.id',
      'user-456',
    );
  });

  it('should set client name and version attributes when resolved', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing(
      'my_tool',
      ctx({ name: 'cursor', version: '1.2.3' }),
      handler,
    );
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.client.name',
      'cursor',
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.client.version',
      '1.2.3',
    );
  });

  it('should set only the client name when version is unresolved', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing(
      'my_tool',
      ctx({ name: 'opencode' }),
      handler,
    );
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.client.name',
      'opencode',
    );
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.client.version',
      expect.anything(),
    );
  });

  it('should not set client attributes when identity is unresolved', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', ctx({}), handler);
    await traced({});

    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.client.name',
      expect.anything(),
    );
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.client.version',
      expect.anything(),
    );
  });

  it('should tolerate a context without an mcpClient', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const contextNoClient = { teamId: 'team-123', userId: 'user-456' };

    const traced = withToolTracing('my_tool', contextNoClient, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.name',
      'my_tool',
    );
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.client.name',
      expect.anything(),
    );
  });

  it('should set OK status for successful results', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should set ERROR status for isError results', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'something went wrong' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2, // SpanStatusCode.ERROR
      message: 'something went wrong',
    });
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('mcp.tool.error', true);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should join all text blocks into the ERROR status message', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [
        { type: 'text', text: 'Query failed' },
        { type: 'text', text: 'timeout after 10000ms' },
      ],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'Query failed\ntimeout after 10000ms',
    });
  });

  it('should truncate a long ERROR status message', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'x'.repeat(600) }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: `${'x'.repeat(512)}...`,
    });
  });

  it('should omit the status message when the error has no text', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: '   ' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: undefined,
    });
  });

  it('should set ERROR status and re-throw on handler exception', async () => {
    const error = new Error('boom');
    const handler = jest.fn().mockRejectedValue(error);

    const traced = withToolTracing('my_tool', context, handler);

    await expect(traced({})).rejects.toThrow('boom');

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'boom',
    });
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should record duration on the span', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.duration_ms',
      expect.any(Number),
    );
  });

  it('should record duration metric on success', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockDurationHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        tool: 'my_tool',
        source_kind: 'none',
      },
    );
    expect(mockCounter.add).not.toHaveBeenCalled();
  });

  it('should record the response size in UTF-8 bytes on span and histogram', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [
        { type: 'text', text: 'abc' },
        { type: 'text', text: 'é' }, // 2 bytes in UTF-8
      ],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.response.size_bytes',
      5,
    );
    expect(mockResponseSizeHistogram.record).toHaveBeenCalledWith(5, {
      tool: 'my_tool',
      outcome: 'success',
    });
  });

  it('should record the response size of error results', async () => {
    const handler = jest.fn().mockResolvedValue(mcpUserError('bad input'));

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockResponseSizeHistogram.record).toHaveBeenCalledWith(9, {
      tool: 'my_tool',
      outcome: 'error',
    });
  });

  it('should increment the error counter for isError results', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'nope' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockCounter.add).toHaveBeenCalledWith(1, {
      tool: 'my_tool',
      error_category: 'server',
      source_kind: 'none',
    });
  });

  it('should increment the error counter on a thrown exception', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));

    const traced = withToolTracing('my_tool', context, handler);

    await expect(traced({})).rejects.toThrow('boom');

    expect(mockCounter.add).toHaveBeenCalledWith(1, {
      tool: 'my_tool',
      error_category: 'server',
      source_kind: 'none',
    });
    expect(mockDurationHistogram.record).toHaveBeenCalledWith(
      expect.any(Number),
      {
        tool: 'my_tool',
        source_kind: 'none',
      },
    );
  });

  // ─── Error category tests ───────────────────────────────────────────────

  it('should default error_category to "server" when no category is set', async () => {
    const handler = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'unknown failure' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.error_category',
      'server',
    );
  });

  it('should record error_category "user" on span and counter', async () => {
    const handler = jest.fn().mockResolvedValue(mcpUserError('bad input'));

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.error_category',
      'user',
    );
    expect(mockCounter.add).toHaveBeenCalledWith(1, {
      tool: 'my_tool',
      error_category: 'user',
      source_kind: 'none',
    });
  });

  it('should record error_category "server" on span and counter', async () => {
    const handler = jest
      .fn()
      .mockResolvedValue(mcpServerError('database timeout'));

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'mcp.tool.error_category',
      'server',
    );
    expect(mockCounter.add).toHaveBeenCalledWith(1, {
      tool: 'my_tool',
      error_category: 'server',
      source_kind: 'none',
    });
  });

  it('should not set error_category on successful results', async () => {
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', context, handler);
    await traced({});

    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.tool.error_category',
      expect.anything(),
    );
  });

  it('should not leak error category metadata on the returned result', async () => {
    const handler = jest.fn().mockResolvedValue(mcpUserError('bad input'));

    const traced = withToolTracing('my_tool', context, handler);
    const result = await traced({});

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'bad input' }],
    });
    expect(result).not.toHaveProperty('_errorCategory');
  });

  describe('source attribution', () => {
    const logSource = { _id: 'source-log', kind: SourceKind.Log };
    const traceSource = { _id: 'source-trace', kind: SourceKind.Trace };
    const ok = { content: [{ type: 'text' as const, text: 'ok' }] };

    it('records the source id, kind and ids on the tool span', async () => {
      const traced = withToolTracing('my_tool', context, async () => {
        recordMcpSource(logSource);
        return ok;
      });
      await traced({});

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'mcp.source.id',
        'source-log',
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'mcp.source.kind',
        'log',
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('mcp.source.ids', [
        'source-log',
      ]);
    });

    it('lands on the tool span when a nested child span is active', async () => {
      const traced = withToolTracing('my_tool', context, () =>
        withSpan('mcp.child.work', async () => {
          recordMcpSource(logSource);
          return ok;
        }),
      );
      await traced({});

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'mcp.source.id',
        'source-log',
      );
      expect(mockChildSpan.setAttribute).not.toHaveBeenCalled();
      expect(mockChildSpan.setAttributes).not.toHaveBeenCalled();
    });

    it('keeps the first source as primary and lists every distinct source', async () => {
      const traced = withToolTracing('my_tool', context, async () => {
        recordMcpSource(traceSource);
        recordMcpSource(logSource);
        recordMcpSource(traceSource);
        return ok;
      });
      await traced({});

      const calls = mockSpan.setAttribute.mock.calls;
      const valuesOf = (key: string) =>
        calls.filter(([k]) => k === key).map(([, v]) => v);
      expect(valuesOf('mcp.source.id')).toEqual(['source-trace']);
      expect(valuesOf('mcp.source.kind')).toEqual(['trace']);
      expect(valuesOf('mcp.source.ids').at(-1)).toEqual([
        'source-trace',
        'source-log',
      ]);
    });

    it('does not set source attributes when no source is resolved', async () => {
      const traced = withToolTracing('my_tool', context, async () => ok);
      await traced({});

      for (const key of [
        'mcp.source.id',
        'mcp.source.kind',
        'mcp.source.ids',
      ]) {
        expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
          key,
          expect.anything(),
        );
      }
    });

    it('is a no-op outside a tool invocation', () => {
      recordMcpSource(logSource);
      expect(mockSpan.setAttribute).not.toHaveBeenCalled();
      expect(mockChildSpan.setAttribute).not.toHaveBeenCalled();
    });

    it('records the source kind, never the id, on the duration metric', async () => {
      const traced = withToolTracing('my_tool', context, async () => {
        recordMcpSource(traceSource);
        return ok;
      });
      await traced({});

      expect(mockDurationHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        { tool: 'my_tool', source_kind: 'trace' },
      );
    });

    it('records the source kind on the error counter for error results', async () => {
      const traced = withToolTracing('my_tool', context, async () => {
        recordMcpSource(logSource);
        return mcpUserError('bad input');
      });
      await traced({});

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        tool: 'my_tool',
        error_category: 'user',
        source_kind: 'log',
      });
    });

    it('records the source kind on both metrics when the handler throws', async () => {
      const traced = withToolTracing('my_tool', context, async () => {
        recordMcpSource(logSource);
        throw new Error('boom');
      });
      await expect(traced({})).rejects.toThrow('boom');

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        tool: 'my_tool',
        error_category: 'server',
        source_kind: 'log',
      });
      expect(mockDurationHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        { tool: 'my_tool', source_kind: 'log' },
      );
    });

    it('keeps concurrent tool invocations apart', async () => {
      const a = withToolTracing('tool_a', context, async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        recordMcpSource(logSource);
        return ok;
      });
      const b = withToolTracing('tool_b', context, async () => {
        recordMcpSource(traceSource);
        return ok;
      });
      await Promise.all([a({}), b({})]);

      expect(mockDurationHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        { tool: 'tool_a', source_kind: 'log' },
      );
      expect(mockDurationHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        { tool: 'tool_b', source_kind: 'trace' },
      );
    });
  });
});
