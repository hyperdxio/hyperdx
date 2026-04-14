// Mock OpenTelemetry and all modules that transitively import it
// These must be declared before any imports

const mockSpan = {
  setAttribute: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
};

const mockTracer = {
  startActiveSpan: (
    _name: string,
    fn: (span: typeof mockSpan) => Promise<unknown>,
  ) => fn(mockSpan),
};

jest.mock('@opentelemetry/api', () => ({
  __esModule: true,
  default: {
    trace: {
      getTracer: () => mockTracer,
    },
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
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

import { withToolTracing } from '../utils/tracing';

describe('withToolTracing', () => {
  const context = { teamId: 'team-123', userId: 'user-456' };

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

  it('should not set user id attribute when userId is undefined', async () => {
    const noUserContext = { teamId: 'team-123' };
    const handler = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    const traced = withToolTracing('my_tool', noUserContext, handler);
    await traced({});

    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'mcp.user.id',
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
});
