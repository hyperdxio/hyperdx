import type { AsyncChdb } from 'chdb-wasm';
import type * as ChdbModule from 'chdb-wasm';
import type {
  ColumnMetaType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';

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

      const db = await AsyncChdb.create({
        moduleUrl: bundle.moduleUrl,
        wasmUrl: bundle.wasmUrl,
        workerUrl: `${baseUrl}/worker.js`,
      });
      // Output what the remote client asks ClickHouse for, since the charts
      // parse both the same way: exact 64-bit integers, and ISO date times
      // with their `Z` (without it, the browser reads them as local time).
      // Applies to every later query on this connection.
      await db.query(
        "SET output_format_json_quote_64bit_integers = 1, date_time_output_format = 'iso', date_time_input_format = 'best_effort'",
      );
      return db;
    })
    .catch(err => {
      dbPromise = undefined;
      throw err;
    });

  return dbPromise;
}

/** Backtick-quotes a column name; result column names are arbitrary text. */
export const quoteIdentifier = (name: string) =>
  `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;

/** The rows in `file`, typed by the result `meta`, as a table chdb can query. */
export const chdbFileTable = (file: string, meta: ColumnMetaType[]) =>
  `file('${escapeSqlString(file)}', 'JSONEachRow', '${escapeSqlString(
    meta.map(({ name, type }) => `${quoteIdentifier(name)} ${type}`).join(', '),
  )}')`;

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
