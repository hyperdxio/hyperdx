/**
 * Returns a function that each of `count` callers calls and awaits. `fn` runs
 * once, after the last of them has called it, and every caller's promise
 * settles when `fn` does.
 */
export function runOnceAfterAll(
  count: number,
  fn: () => Promise<void>,
): () => Promise<void> {
  let arrived = 0;
  let release = () => {};
  const allArrived = new Promise<void>(resolve => {
    release = resolve;
  });
  const done = allArrived.then(fn);
  return () => {
    arrived += 1;
    if (arrived >= count) {
      release();
    }
    return done;
  };
}
