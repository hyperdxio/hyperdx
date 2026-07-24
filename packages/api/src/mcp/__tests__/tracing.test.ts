// Mock OpenTelemetry and all modules that transitively import it
// These must be declared before any imports

const mockSpan = {
  setAttribute: jest.fn(),
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
};

const mockTracer = {
  startActiveSpan: (
    _name: string,
    _optionsOrFn: unknown,
    maybeFn?: (span: typeof mockSpan) => Promise<unknown>,
  ) => {
    const fn = (
      typeof _optionsOrFn === 'function' ? _optionsOrFn : maybeFn
    ) as (span: typeof mockSpan) => Promise<unknown>;
    return fn(mockSpan);
  },
};

const mockCounter = { add: jest.fn() };
const mockHistogram = { record: jest.fn() };
const mockMeter = {
  createCounter: jest.fn(() => mockCounter),
  createHistogram: jest.fn(() => mockHistogram),
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

import type { McpContext } from '@/mcp/tools/types';
import { mcpServerError, mcpUserError } from '@/mcp/utils/errors';
import type { McpClientInfo } from '@/mcp/utils/mcpClient';
import { withToolTracing } from '@/mcp/utils/tracing';

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

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // SpanStatusCode.ERROR
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('mcp.tool.error', true);
    expect(mockSpan.end).toHaveBeenCalled();
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

    expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
      tool: 'my_tool',
    });
    expect(mockCounter.add).not.toHaveBeenCalled();
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
    });
  });

  it('should increment the error counter on a thrown exception', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));

    const traced = withToolTracing('my_tool', context, handler);

    await expect(traced({})).rejects.toThrow('boom');

    expect(mockCounter.add).toHaveBeenCalledWith(1, {
      tool: 'my_tool',
      error_category: 'server',
    });
    expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
      tool: 'my_tool',
    });
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
});
