// Mock OpenTelemetry + the HyperDX SDK before importing the module under test.

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
    _options: unknown,
    fn: (span: typeof mockSpan) => Promise<unknown>,
  ) => fn(mockSpan),
};

const mockCounter = { add: jest.fn() };
const mockHistogram = { record: jest.fn() };
const mockMeter = {
  createCounter: jest.fn(() => mockCounter),
  createHistogram: jest.fn(() => mockHistogram),
};

const mockSetTraceAttributes = jest.fn();

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
  SpanStatusCode: { OK: 1, ERROR: 2 },
  SpanKind: { INTERNAL: 0, SERVER: 1, CLIENT: 2, PRODUCER: 3, CONSUMER: 4 },
}));

jest.mock('@hyperdx/node-opentelemetry', () => ({
  __esModule: true,
  setTraceAttributes: (...args: unknown[]) => mockSetTraceAttributes(...args),
}));

jest.mock('@/config', () => ({
  CODE_VERSION: 'test-version',
  IS_LOCAL_APP_MODE: false,
  IS_PROMQL_ENABLED: true,
  USAGE_STATS_ENABLED: false,
  RUN_SCHEDULED_TASKS_EXTERNALLY: false,
  AI_API_KEY: '',
  ANTHROPIC_API_KEY: 'present',
}));

import {
  getCounter,
  getHistogram,
  getStaticFeatureFlags,
  recordDuration,
  setBusinessContext,
  SpanStatusCode,
  withSpan,
} from '@/utils/instrumentation';

describe('instrumentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withSpan', () => {
    it('runs the handler, sets OK status, and ends the span', async () => {
      const result = await withSpan('op', async () => 'value');

      expect(result).toBe('value');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('does not set OK status when recordOkStatus is false', async () => {
      await withSpan('op', async () => 'value', { recordOkStatus: false });

      expect(mockSpan.setStatus).not.toHaveBeenCalled();
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('records exceptions, sets ERROR status, ends the span, and rethrows', async () => {
      const error = new Error('boom');

      await expect(
        withSpan('op', async () => {
          throw error;
        }),
      ).rejects.toThrow('boom');

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'boom',
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('setBusinessContext', () => {
    it('maps team/user/email to standardized keys on trace and span', () => {
      setBusinessContext({
        teamId: 'team-1',
        userId: 'user-1',
        email: 'a@b.com',
      });

      const expected = {
        'hyperdx.team.id': 'team-1',
        'user.id': 'user-1',
        'user.email': 'a@b.com',
      };
      expect(mockSetTraceAttributes).toHaveBeenCalledWith(expected);
      expect(mockSpan.setAttributes).toHaveBeenCalledWith(expected);
    });

    it('passes through extra attributes and skips nullish values', () => {
      setBusinessContext({
        teamId: 'team-1',
        userId: null,
        'feature_flag.local_app_mode': true,
      });

      expect(mockSetTraceAttributes).toHaveBeenCalledWith({
        'hyperdx.team.id': 'team-1',
        'feature_flag.local_app_mode': true,
      });
    });

    it('is a no-op when there is nothing to set', () => {
      setBusinessContext({});

      expect(mockSetTraceAttributes).not.toHaveBeenCalled();
      expect(mockSpan.setAttributes).not.toHaveBeenCalled();
    });
  });

  describe('getStaticFeatureFlags', () => {
    it('reflects config-derived flag states', () => {
      expect(getStaticFeatureFlags()).toEqual({
        'feature_flag.local_app_mode': false,
        'feature_flag.promql_enabled': true,
        'feature_flag.usage_stats_enabled': false,
        'feature_flag.ai_assistant_enabled': true,
        'feature_flag.scheduled_tasks_external': false,
      });
    });
  });

  describe('metric accessors', () => {
    it('memoizes counters by name', () => {
      const a = getCounter('hyperdx.test.counter');
      const b = getCounter('hyperdx.test.counter');

      expect(a).toBe(b);
      expect(mockMeter.createCounter).toHaveBeenCalledTimes(1);
    });

    it('memoizes histograms by name', () => {
      const a = getHistogram('hyperdx.test.histogram');
      const b = getHistogram('hyperdx.test.histogram');

      expect(a).toBe(b);
      expect(mockMeter.createHistogram).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordDuration', () => {
    it('records duration and returns the result on success', async () => {
      const histogram = getHistogram('hyperdx.test.duration');
      const result = await recordDuration(histogram, async () => 42, {
        op: 'x',
      });

      expect(result).toBe(42);
      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        op: 'x',
      });
    });

    it('records duration even when the function throws', async () => {
      const histogram = getHistogram('hyperdx.test.duration');

      await expect(
        recordDuration(histogram, async () => {
          throw new Error('nope');
        }),
      ).rejects.toThrow('nope');

      expect(mockHistogram.record).toHaveBeenCalledWith(
        expect.any(Number),
        undefined,
      );
    });
  });
});
