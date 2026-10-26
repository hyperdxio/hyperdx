import type { AsyncChdb } from 'chdb-wasm';

// Copied into public/ by next.config.mjs. The worker is served from there too,
// rather than left to chdb-wasm's dynamic `new URL('./worker' + ext,
// import.meta.url)`, which bundlers can't reliably resolve.
const ASSET_DIR = 'chdb-wasm';

let dbPromise: Promise<AsyncChdb> | undefined;

// Browser-only: under Node, chdb-wasm treats these URLs as filesystem paths.
export function getChdb(basePath = ''): Promise<AsyncChdb> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('chdb is only available in the browser'));
  }

  dbPromise ??= import('chdb-wasm')
    .then(async ({ AsyncChdb, selectBundle }) => {
      const baseUrl = `${basePath}/${ASSET_DIR}`;
      // The app isn't cross-origin isolated, so the threaded bundle can't run.
      const bundle = selectBundle({ baseUrl, threads: 'st' });
      if (!bundle.supported) throw new Error(bundle.reasons.join('; '));

      return AsyncChdb.create({
        moduleUrl: bundle.moduleUrl,
        wasmUrl: bundle.wasmUrl,
        workerUrl: `${baseUrl}/worker.js`,
      });
    })
    .catch(err => {
      dbPromise = undefined;
      throw err;
    });

  return dbPromise;
}
