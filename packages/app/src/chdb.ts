import type { AsyncChdb } from 'chdb-wasm';
import type * as ChdbModule from 'chdb-wasm';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';

// Copied into public/ by next.config.mjs. The package is imported from there
// at runtime rather than bundled: webpack fails on its Node-only code paths,
// and bundlers can't reliably resolve its dynamic `new URL('./worker' + ext,
// import.meta.url)` either.
const ASSET_DIR = 'chdb-wasm';

/** chdb runs in a Web Worker, so SSR and jsdom never load it. */
export const IS_CHDB_AVAILABLE =
  typeof window !== 'undefined' && typeof Worker !== 'undefined';

let dbPromise: Promise<AsyncChdb> | undefined;

// Browser-only: under Node, chdb-wasm treats these URLs as filesystem paths.
export function getChdb(basePath = ''): Promise<AsyncChdb> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('chdb is only available in the browser'));
  }

  const baseUrl = `${basePath}/${ASSET_DIR}`;
  dbPromise ??= import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ `${baseUrl}/index.js`
  )
    .then(async ({ AsyncChdb, selectBundle }: typeof ChdbModule) => {
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

let fileCount = 0;

/** Runs the SQL from `buildSql` over `rows`, which it reads as a JSONEachRow file. */
export async function queryChdbRows(
  db: AsyncChdb,
  rows: unknown[],
  buildSql: (file: string) => string,
): Promise<ResponseJSON<Record<string, unknown>>> {
  const file = `hdx_rows_${++fileCount}.jsonl`;
  await db.registerFile(
    file,
    new Blob(rows.map(row => `${JSON.stringify(row)}\n`)),
  );
  try {
    const result = await db.query(buildSql(file), 'JSON');
    return JSON.parse(result.text());
  } finally {
    await db.unregisterFile(file);
  }
}
