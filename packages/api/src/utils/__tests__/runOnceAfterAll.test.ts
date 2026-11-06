import { runOnceAfterAll } from '@/utils/runOnceAfterAll';

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

describe('runOnceAfterAll', () => {
  it('runs once, after the last caller arrives', async () => {
    const fn = jest.fn(async () => {});
    const arrive = runOnceAfterAll(2, fn);

    let firstSettled = false;
    const first = arrive().then(() => {
      firstSettled = true;
    });
    await flushPromises();
    expect(fn).not.toHaveBeenCalled();
    expect(firstSettled).toBe(false);

    await Promise.all([first, arrive()]);
    expect(fn).toHaveBeenCalledTimes(1);

    await arrive();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('settles every caller only when fn settles', async () => {
    let finish = () => {};
    const arrive = runOnceAfterAll(
      2,
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    );

    const settled: string[] = [];
    const callers = [
      arrive().then(() => settled.push('app')),
      arrive().then(() => settled.push('opamp')),
    ];
    await flushPromises();
    expect(settled).toEqual([]);

    finish();
    await Promise.all(callers);
    expect(settled).toEqual(['app', 'opamp']);
  });
});
