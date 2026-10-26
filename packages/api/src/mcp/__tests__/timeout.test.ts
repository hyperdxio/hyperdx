import {
  DeadlineExceededError,
  runWithTimeout,
  withDeadline,
} from '@/mcp/utils/timeout';

const never = () => new Promise<never>(() => {});

describe('runWithTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the value when work finishes in time and aborts the signal on exit', async () => {
    let captured: AbortSignal | undefined;
    const outcome = await runWithTimeout(
      async signal => {
        captured = signal;
        return 'done';
      },
      { timeoutMs: 1000 },
    );
    expect(outcome).toEqual({ timedOut: false, value: 'done' });
    expect(captured?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out and aborts the signal at the deadline', async () => {
    let captured: AbortSignal | undefined;
    const pending = runWithTimeout(
      signal => {
        captured = signal;
        return never();
      },
      { timeoutMs: 1000 },
    );
    await jest.advanceTimersByTimeAsync(999);
    expect(captured?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ timedOut: true });
    expect(captured?.aborted).toBe(true);
  });

  it('reports a timeout without grace even when work resolves on abort', async () => {
    const pending = runWithTimeout(
      signal =>
        new Promise<string>(resolve =>
          signal.addEventListener('abort', () => resolve('too late')),
        ),
      { timeoutMs: 1000 },
    );
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ timedOut: true });
  });

  it('reports a timeout without grace when work rejects on abort', async () => {
    const pending = runWithTimeout(
      signal =>
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      { timeoutMs: 1000 },
    );
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ timedOut: true });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps a result returned inside the grace window after the abort', async () => {
    const pending = runWithTimeout(
      signal =>
        new Promise<string>(resolve =>
          signal.addEventListener('abort', () => resolve('partial')),
        ),
      { timeoutMs: 1000, graceMs: 500 },
    );
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({
      timedOut: false,
      value: 'partial',
    });
  });

  it('stops waiting at the end of the grace window when work ignores the signal', async () => {
    let settled = false;
    const pending = runWithTimeout(never, {
      timeoutMs: 1000,
      graceMs: 500,
    }).finally(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ timedOut: true });
  });

  it('treats a rejection after the abort as a timeout', async () => {
    const pending = runWithTimeout(
      signal =>
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      { timeoutMs: 1000, graceMs: 500 },
    );
    await jest.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ timedOut: true });
  });

  it('rethrows a rejection raised before the deadline and aborts the signal', async () => {
    let captured: AbortSignal | undefined;
    await expect(
      runWithTimeout(
        signal => {
          captured = signal;
          return Promise.reject(new Error('boom'));
        },
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow('boom');
    expect(captured?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('withDeadline', () => {
  it('resolves work that finishes before the deadline', async () => {
    await expect(
      withDeadline(() => Promise.resolve('done'), Date.now() + 1000),
    ).resolves.toBe('done');
  });

  it('rejects with DeadlineExceededError when work exceeds the deadline', async () => {
    const slow = () =>
      new Promise<string>(resolve => setTimeout(() => resolve('too late'), 50));
    await expect(withDeadline(slow, Date.now() + 5)).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
  });

  it('does not start the work when the shared deadline is already in the past', async () => {
    // Work scheduled after the batch budget is spent must fail fast WITHOUT
    // invoking the thunk — this is what keeps the post-deadline drain from
    // issuing any (un-cancellable) ClickHouse queries.
    const start = jest.fn(() => Promise.resolve('too late'));
    await expect(withDeadline(start, Date.now() - 1)).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    expect(start).not.toHaveBeenCalled();
  });

  it('propagates a rejection from the underlying work', async () => {
    const boom = () => Promise.reject(new Error('boom'));
    await expect(withDeadline(boom, Date.now() + 1000)).rejects.toThrow('boom');
  });

  it('aborts the signal handed to the work when the deadline fires', async () => {
    // The signal must fire so the in-flight ClickHouse query is cancelled
    // server-side rather than left running after the batch gives up on it.
    let captured: AbortSignal | undefined;
    const slow = (signal: AbortSignal) => {
      captured = signal;
      return new Promise<string>(resolve =>
        setTimeout(() => resolve('too late'), 50),
      );
    };
    await expect(withDeadline(slow, Date.now() + 5)).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );
    expect(captured?.aborted).toBe(true);
  });

  it('aborts the signal once work resolves so no query outlives the call', async () => {
    let captured: AbortSignal | undefined;
    const work = (signal: AbortSignal) => {
      captured = signal;
      return Promise.resolve('done');
    };
    await expect(withDeadline(work, Date.now() + 1000)).resolves.toBe('done');
    expect(captured?.aborted).toBe(true);
  });
});
