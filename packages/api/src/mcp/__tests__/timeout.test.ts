import { runWithTimeout } from '@/mcp/utils/timeout';

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
